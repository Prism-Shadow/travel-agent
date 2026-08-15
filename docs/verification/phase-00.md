# Phase 0 verification record

| | |
| --- | --- |
| Phase | 0 — 规划与关键验证（design/004 §2 Phase 0） |
| Baseline | `8474f0c` (`docs(design): define Codex-parity browser architecture and production roadmap`) |
| Date | 2026-08-15 |
| Host | Linux 6.1.0-40-amd64 · Node v24.18.0 · pnpm 11.18.0 · Electron 43.2.0 · headless (Xvfb), datacenter IP |
| Scope | Records commands, evidence, verdicts and limits. **Does not modify 001/002/003** — Phase 0's 非目标 says so, and any change to those documents is a separate, reviewed edit. |

---

## 1. Verdicts

| # | Question | Verdict | Confidence |
| --- | --- | --- | --- |
| V1 | Can Playwright / CDP drive an Electron `WebContentsView`? | **YES** | Direct evidence, this host |
| V2 | Does `context.newPage()` / `Target.createTarget` work on Electron? | **NO — "Not supported"** | Direct evidence, both via raw debugger and via Playwright |
| V3 | Is `safeStorage` usable here, and does the fail-closed rule trigger correctly? | **NOT USABLE here → vault must not start** (rule fires correctly) | Direct evidence, Linux only. macOS/Windows PENDING |

Supporting smoke: **Ctrip is reachable** from a fresh Electron partition (§5).

---

## 2. V1 — Electron `WebContentsView` + CDP + Playwright

### Commands

```bash
# probe A: WebContentsView + webContents.debugger (no debugging port involved)
cd packages/desktop
xvfb-run -a ./node_modules/.bin/electron <scratch>/iab-probe.cjs

# probe B: Playwright connectOverCDP against a DEV-ONLY debugging port
xvfb-run -a ./node_modules/.bin/electron <scratch>/host.cjs --remote-debugging-port=19871 &
curl -s http://127.0.0.1:19871/json/version
curl -s http://127.0.0.1:19871/json/list
node <scratch>/pw-probe.cjs 19871
pkill -f host.cjs   # port confirmed closed afterwards
```

### Evidence

```
PROBE {"step":"webcontentsview","ok":true,"title":"iab","url":"data:text/html,..."}
PROBE {"step":"debugger","ok":true,"product":"Chrome/150.0.7871.129","protocol":"1.3",
       "domRoot":true,"axNodes":8,"targets":2}

PW {"step":"connect","ok":true,"contexts":1,"pages":2,"titles":["host","iab-page"]}
PW {"step":"click","ok":true,"title":"clicked"}
```

### What this establishes

- `new WebContentsView(...)` + `win.contentView.addChildView(view)` + `view.setBounds(...)` work on
  Electron 43.2.0. This is the API 002 §3 assumes.
- `webContents.debugger.attach('1.3')` then `sendCommand` works for `Browser.getVersion`,
  `DOM.getDocument`, `Accessibility.getFullAXTree` (8 nodes on a trivial page),
  `Input.dispatchMouseEvent` and `Target.getTargets`. **This is the transport 002 §4.2 candidate C
  depends on, and it is viable.**
- Playwright's `connectOverCDP` attaches and `page.click('#b')` really actuates the page (the page's
  own handler set `document.title = 'clicked'`). So the relay's existing Playwright surface can drive
  an IAB view.

### Limits

- The ARIA step in probe B printed an error (`Cannot read properties of undefined (reading 'snapshot')`)
  because the probe used `page.accessibility`, an API removed in this Playwright line. **That is a
  defect in the probe, not a product finding.** The accessibility data itself is available — probe A's
  raw `Accessibility.getFullAXTree` returned nodes. Phase 1 should assert ARIA through the executor's
  own `getAriaSnapshot`, which is the path the product actually uses.
- The debugging port in probe B is **dev-only**, passed on the command line, and the process was torn
  down at the end (port confirmed closed). No product config was touched. 002 §4.2 rejects this as a
  shipping transport, and §5-level CI guards for it land in Phase 5.
- **Observed, and it corroborates that rejection:** `/json/list` exposed *both* targets — the IAB page
  **and the host window** (`"title":"host"`). An attacker on the port would reach the app's own
  renderer, which is exactly 003 §1.1's argument.

---

## 3. V2 — `Target.createTarget` is not supported

### Evidence

```
PROBE {"step":"target_createTarget_via_debugger","ok":false,"error":"Not supported"}
PW    {"step":"newPage","ok":false,
       "error":"browserContext.newPage: Protocol error (Target.createTarget): Not supported"}
```

### What this establishes

**002 §11.3 item 1 is answered, and the prediction in that item was correct.** Electron does not
create a view in response to `Target.createTarget`, through either the raw debugger or Playwright.

### Phase 1 design input (binding)

- `tabs.open()` in `mode: 'iab'` **must** route to the Electron main process to construct a
  `WebContentsView`. It must not call Playwright's `newPage()` / `context.newPage()`.
- `executor.ts`'s `openOwnedTab` needs an `iab` branch; the existing `acquireAndNavigateOwnedTab`
  contract in `tab-ownership.ts` still applies (claim-then-navigate, release on failure), only the
  `create` callback changes.
- Anything in the relay that assumes "the browser can mint its own targets" needs an IAB-specific
  path. `tabRegistry` itself is unaffected — it keys on CDP target id, and IAB views do have target ids
  (`Target.getTargets` returned 2).

---

## 4. V3 — `safeStorage` capability and fail-closed

### Command (committed, reproducible)

```bash
pnpm --filter @prismshadow/penguin-desktop exec electron scripts/probe-safe-storage.mjs
# headless Linux: xvfb-run -a ./node_modules/.bin/electron scripts/probe-safe-storage.mjs
```

Exit code is the decision: `0` = vault may start, `1` = it must not.

### Evidence (this host)

```json
{"platform":"linux","electron":"43.2.0","isEncryptionAvailable":false,"backend":"basic_text",
 "hasAsyncApi":true,"roundTrip":null,"cipherContainsPlaintext":null,"vaultAllowed":false,
 "reason":"safeStorage reports encryption is unavailable"}
```

### What this establishes

- **This host is the fail-closed case.** No keyring is reachable; `isEncryptionAvailable()` is false and
  the Linux backend is `basic_text`. Per 003 §4.4 the vault must refuse to start, and the probe says so.
  Useful side effect: the degraded path can be exercised natively here, in CI and in dev, rather than
  simulated.
- **The async API exists on Electron 43.2.0** (`encryptStringAsync` / `decryptStringAsync`), so 003 §4.2's
  "prefer async" is actionable in Phase 4.

### PENDING — not run, not inferred

| Platform | Status | How to close |
| --- | --- | --- |
| macOS (Keychain) | **PENDING** | Run the committed probe on a Mac; expect `isEncryptionAvailable: true`, `vaultAllowed: true` |
| Windows (DPAPI) | **PENDING** | Run the committed probe on Windows; same expectation |
| Linux **with** a keyring (gnome-keyring / kwallet) | **PENDING** | Run on a desktop session; expect backend `gnome_libsecret` or `kwallet*` and `vaultAllowed: true` |

These are recorded as PENDING because they were **not executed**. No result is claimed for them.

---

## 5. Ctrip reachability smoke

Read-only, anonymous navigation from a fresh `persist:` partition with a Chrome-like UA. No login,
no form submission, no automation of a booking flow.

```
CTRIP {"target":"home","ok":true,"ms":8619,
       "title":"携程旅行网:酒店预订,机票预订查询,旅游度假,商旅管理","bodyLen":3425}
CTRIP {"target":"hotel_channel","ok":true,"ms":7521,
       "title":"海外酒店预订,国际酒店价格查询,...-[携程酒店]","bodyLen":1275}
```

**Verdict: reachable.** Both pages returned real rendered content — no interstitial, no challenge page.
This is a positive early signal for risk **R1** (004 §8) and is consistent with 001 §9's M0 note that the
obstacle was a login wall rather than bot detection.

**Limits — do not over-read this.** It does not test search submission, login, checkout, sustained
automated interaction, or behaviour once `Input.dispatch*` traffic starts. R1 stays open; the
meaningful test is Phase 1's real form drive (004 Phase 1 exit criteria).

---

## 6. Repository baseline

### Build / typecheck / tests

`pnpm install` and `pnpm build` succeed. `pnpm build` ends with two non-fatal `pnpm link` warnings
(`global bin directory ... is not in PATH`); the script tolerates them by design.

`pnpm typecheck` passes for all 10 packages.

| Package | Result |
| --- | --- |
| core | **852 passed, 5 skipped** (+56 new, §7) |
| server | 594 passed |
| web | 650 passed |
| cli | 235 passed |
| transaction | 51 passed |
| travel-domain | 44 passed |
| skills | 21 passed |
| browser-extension | 9 passed |
| **browser-cli** | **see below** |

### Formatting: the workspace check fails on a file this commit does not touch

**`pnpm format:check` exits 1.** It is not green, and this record does not claim it is.

```
$ pnpm format:check
Checking formatting...
[warn] packages/desktop/src/main.ts
[warn] Code style issues found in the above file.
ELIFECYCLE  Command failed with exit code 1.
```

| Fact | Evidence |
| --- | --- |
| The sole offender is `packages/desktop/src/main.ts` | Output above — one file listed |
| It is **not** in this commit's diff | `git show --stat --name-only HEAD \| grep desktop/src/main.ts` → no match |
| It was already non-compliant before Phase 0 | `git diff HEAD -- packages/desktop/src/main.ts` is empty while `prettier --check` on it still warns |
| Every file this commit adds or edits **is** compliant | `prettier --check` over the changed paths → "All matched files use Prettier code style!" |

Left as found. Phase 0's scope is verification and scaffolding; reformatting an untouched product
file would put an unrelated change inside a checkpoint that is supposed to be independently
revertible (004 §3). Fixing it belongs in its own commit.

### browser-cli is not green in a clean environment — pre-existing

Initially **11 files failed**, all with:

```
Error: browserType.launchPersistentContext: Executable doesn't exist at
  /home/cc/.cache/ms-playwright/chromium-1209/chrome-linux64/chrome
```

Root cause, by inspection rather than guess:

- `@xmorse/playwright-core@1.59.10` pins chromium revision **1209** (`browsers.json`).
- `@xmorse/playwright-core` is **not** listed in `pnpm-workspace.yaml`'s `allowBuilds`, so pnpm skips its
  postinstall — the browser download never runs.
- `.github/workflows/ci.yml` runs `pnpm test` but has **no** browser-install step.
- The vendored installer additionally fails on Node 24 (`TypeError: onExit is not a function`), and
  revision 1209 is no longer served by the Playwright CDN (HTTP 400 on both known hosts).

**Conclusion: these failures are a pre-existing baseline condition, not a regression from Phase 0.**
Any clean checkout — including CI — lacks the browsers these tests need.

Mitigation used here (local environment only, nothing committed): symlinked the cached revision 1228
as 1209.

```bash
ln -sfn ~/.cache/ms-playwright/chromium-1228 ~/.cache/ms-playwright/chromium-1209
ln -sfn ~/.cache/ms-playwright/chromium_headless_shell-1228 ~/.cache/ms-playwright/chromium_headless_shell-1209
```

That takes it from **11 failed → 6 failed / 341 passed**. The 6 residuals, characterised:

| Test | Cause |
| --- | --- |
| `relay-core` · hidden element / covered element / display:none (3) | Assert Playwright's descriptive actionability text (`Element is not visible`, `intercepts pointer events`) within a **500 ms** click budget. On this host the click reports `Timeout 500ms exceeded` with the call log stopping at "waiting for element to be visible, enabled and stable". Timing-sensitive under a substituted Chromium in a container. |
| `relay-core` · duplicate dialog dismissals | Same family; also emitted `ENOENT ... relay-server.log`. |
| `relay-core` · system colour scheme | Expects `matchesDark: true`; a headless container reports light. Environment-dependent. |
| `snapshot-tools` · screenshot | Image snapshot mismatch — rendering differs between chromium 1209 and the substituted 1228. |

All six are explained by the substituted browser build and the headless container, not by product
behaviour. **No product code was changed to make anything pass.**

Running the suite also produced untracked artifacts — `packages/browser-cli/src/aria-snapshots/`,
`src/snapshots/`, `tmp/`. These were **deleted, not committed**: they are regenerable test output, and
because they came from the substituted chromium 1228 they would have baked a wrong baseline into the
repository. They were also not covered by any `.gitignore` at the time, which is noted in §8 as a Phase 1 input
and was acted on there: the root `.gitignore` now names the three directories.

Recommendation (not actioned in Phase 0, needs its own review): decide whether to add a browser
provisioning step to CI, or mark these suites as requiring one. Filed as a Phase 1 input in §8.

---

## 7. What Phase 0 added

| Path | Purpose |
| --- | --- |
| `packages/core/src/state/feature-flags.ts` | Flag registry, defaults (all off), strict override parsing, dependency closure, capability probe |
| `packages/core/test/feature-flags.test.ts` | 56 tests — defaults and their immutability, strict parsing (a misspelled value must not enable anything, last-entry-wins), closure chains, and the probe being unskippable rather than merely available |
| `packages/core/src/state/index.ts` | Re-export |
| `packages/desktop/scripts/probe-safe-storage.mjs` | Committed, reproducible safeStorage probe; exit code = fail-closed decision |
| `docs/manual-testing/_template.md` | Case template + status machine |
| `docs/manual-testing/phase-00-verification.md` | Phase 0's PENDING manual items |
| `docs/verification/phase-00.md` | This record |
| `design/004-…-roadmap.md` | Phase 0 status `planned` → `completed` |

Flag defaults are **all off**, including `iab.enabled`. Phase 0 ships no user-visible capability.

Scratch probes (`iab-probe.cjs`, `host.cjs`, `pw-probe.cjs`, `ctrip-smoke.cjs`) live in the session
scratchpad and are **deliberately not committed** — they hardcode a dev debugging port and a local
`node_modules` path, and neither belongs in the repository.

---

## 8. Phase 1 design inputs

1. **`tabs.open()` must be main-process-routed in IAB mode** (§3). Binding.
2. **Transport candidate C is viable** (§2): `webContents.debugger` speaks the CDP the relay's
   `forwardCDPCommand` tunnel needs. Phase 1 can implement `/iab` against it without re-litigating.
3. **The debugging port exposes the host window** (§2). Keep it out of anything but a local probe;
   the CI guard is Phase 5's.
4. **Assert ARIA through `getAriaSnapshot`**, not `page.accessibility` (§2 limits).
5. **The vault's degraded path is testable natively here** (§4) — Phase 4 should exercise the
   `vaultAllowed: false` branch on this very host rather than mocking it.
6. **Browser provisioning for `browser-cli` tests is unresolved** (§6). Phase 1 adds real-Electron
   coverage, so decide then whether CI grows a provisioning step; otherwise new IAB tests inherit the
   same "cannot run in CI" condition.
7. **R1 stays open** (§5). Ctrip loads, but nothing about automated interaction was tested.
8. **`browser-cli` test output is untracked and unignored** (§6). If Phase 1 keeps running that suite
   locally, add the three artifact paths to a `.gitignore` so a reviewer's `git status` stays readable.
