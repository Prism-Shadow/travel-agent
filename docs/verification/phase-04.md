# Phase 4 verification — the vault, and an execute path the agent cannot hold

What was built, what was verified, and what was deliberately left off. Companion to
`docs/manual-testing/phase-04-privacy-payment.md`, which is the human half and is entirely
`PENDING`.

The whole of this phase is machinery that stays **gated**. design/004 §5 is explicit: the code, the
tests and the dummy-data integration are not blocked, but *enabling* real L2/L3 data, a live secret
fill or an agent-triggered payment requires an isolated agent runtime (003 §0.3), which is Phase 5.
Nothing here reports that isolation, so `vault.l2l3`, `secret_entry.live` and `payments.execute`
resolve **off**, with reasons, on every machine this phase runs on. That is not an accident of
configuration — it is the dependency chain in `feature-flags.ts`, and there are tests pinning the
order (`desktop/test/vault-shell-gating.test.ts`, `server/test/capabilities-route.test.ts`).

The dummy vault fixtures used throughout the automated tests are exactly that — a reversible
transform standing in for the OS keychain, and invented values (`310101199001011234`,
`tok_merchant_1P4kJ2…`). No real personal data and no real credential appears anywhere in the
suite.

---

## 1. The vault (003 §4)

**Location and its honest boundary.** The vault is one JSON document under `userData`, 0600,
write-then-rename, holding a master key and an audit key each wrapped by the OS keychain
(`safeStorage`), and per field a data key wrapped under the master key plus the value sealed under
that data key. What that buys is stated in the code and repeated in the UI: plaintext never reaches
the model's context, the server, the relay or a trace, and a stolen disk yields ciphertext. What it
does **not** buy — until 003 §0.3 lands — is protection from another process running as the same
user. `store.ts`'s class comment carries the full table.

**Field-level DEKs, with AAD binding.** Every sealed thing is AES-256-GCM with additional
authenticated data naming the field and the format version. The point is testable and tested: a
ciphertext moved from `phone_number` to `payment_token` inside the file fails authentication rather
than decrypting into the wrong field (`vault-crypto.test.ts`). Rotation rewraps the data keys and
leaves the values untouched, so it costs one keychain write plus a small rewrap per field.

**Fail-closed storage (003 §4.4, attack A9).** `judgeStorage` decides whether a vault may exist at
all. `safeStorage` unavailable → no vault. A Linux `basic_text` backend (what Electron falls back
to with no keyring) → no vault, because that backend stores recoverable plaintext and a silent
downgrade is worse than an absent feature. An unreadable backend → no vault. All three are unit
tests, and the async `encryptStringAsync` API is preferred per 003 §4.2.

**Three tiers, two immovable boundaries (003 §3).** L1 projects (masked where the table says),
L2 is fill-only behind a handle, L3 is never stored. `put` refuses every L3 field outright, so a
CVV has no path into the file; L3 has no way in or out via `reclassify`; and loosening L2→L1
requires an explicit confirmation and an audit entry, while tightening is free. Unknown fields
default to L2, the strict side (`vault-tiers.test.ts`, `vault-store.test.ts`).

## 2. Grants and handles (003 §5)

A grant names a turn, an eTLD+1 domain (exact, no wildcard), a purpose and an exact field set, and
it expires — L2 in fifteen minutes, an L1-only grant with the turn. The agent gets a projection or
opaque handles `pv:<grantId>:<field>`, never both. The check that matters runs **at redemption**,
against the page the fill is about to happen on: a grant approved for `ctrip.com` is refused on a
page that has navigated elsewhere. `vault-grants.test.ts` is the rejection matrix design/004 asks
for by name — unknown / revoked / expired / wrong-turn / wrong-domain / field-not-granted /
wrong-mode, each with its own reason, plus revocation on turn-end and on vault-lock.

## 3. secureFill and redaction (003 §6)

`secure_fill` takes a handle, re-checks the grant against the live page, decrypts exactly one field,
writes it through the Chrome debugger in an **isolated world**, registers the element for redaction,
wipes the plaintext, and audits by field name. The value never touches the agent's arguments, the
audit log, or the fingerprints published for redaction (`vault-secure-fill.test.ts`,
`debugger-fill-port.test.ts` — the latter proving the value travels as a call argument, not inside
the script source a CDP log would record).

Redaction is text and pixels, treated separately (003 §6.5). Text: main publishes a salted
truncated HMAC plus length and character shape; the relay matches candidate substrings without ever
holding the value, and replaces them with `[REDACTED:field]` (`browser-cli/src/redaction.unit.test.ts`).
Screenshots: a pixel mask over every registered bounding box, and — the conservative default —
**refusal to emit an image at all** when any live value has no box to cover it. The two packages
implement shape and fingerprint independently, so a golden-value pair is pinned on both sides
(`redaction.unit.test.ts` and `vault-redaction-agreement.test.ts`) to catch silent drift. OCR
fallback is behind `redaction.ocr`, off, and explicitly best-effort — not implemented this phase.

## 4. The scoped secret phase (003 §7.3)

The complete version: enter pauses the turn and **detaches the agent's CDP channel** (revokes the
pane's drive gate for that target) before anything is typed; a failed detach types nothing and
leaves the page with the person. Exit requires a **proof** — the field reads empty, the element left
the DOM, or the page navigated away — and only a proven-clear exit reattaches the agent. The other
two exits (unproven → human-only; target_destroyed → close and rebuild elsewhere) never hand the
page back. `secret_entry.live` gates the fill itself and is off; a payment password and a passkey
are never filled under any flag. `vault-secret-phase.test.ts` walks all three exits, the detach
ordering, the fail-closed detach, and the "page cannot be asked → unproven" case.

## 5. Broker IPC (003 §11)

One newline-delimited-JSON channel between the server and the main process, over a Unix socket
(0600) or a Windows named pipe. Three named operations, no generic forwarding, strict parsing
(unknown ops **and** unknown fields refused). Authenticated by a one-shot token minted by main and
handed to the server only through the fork environment, compared in constant time. Rate-limited per
turn. Every call and refusal audited without values. Attacks A3 (no token / forged token) and A4
(well-formed call, wrong turn/domain/target) are `broker-server.test.ts` and
`broker-handlers.test.ts`; the client's transport-vs-refusal distinction is `broker-client.test.ts`.
The residual (003 §11.3) is stated in code and UI: pre-isolation the token is readable by the
agent, so the authentication guards against *other* local software, not the agent.

## 6. Payment capability and the execute path (003 §8, §10)

`PaymentCapability` binds the confirmed summary (`commitmentDigest`), the turn, the merchant domain,
a `maxAmount` with tolerance folded in only when approved, an idempotency key derived from the
**purchase** (so a reissued capability cannot pay twice), and a `paymentMethodRef` that is always an
opaque handle — never a token or a card number. `transaction/test/capability.test.ts` is the P4
matrix: expiry, replay/used, domain mismatch (refused outright, no re-confirm), amount over ceiling,
a rise with no approved slack.

`booking.ts` gained the **fifth check**, ahead of the four it already ran: capability →
authority → drift → journal → submit. The desktop `PaymentAuthority` is where a payment is issued,
the credential resolved (in main, wiped after one call), and `submitBooking` invoked with
`requireCapability`. `payments.execute` is off, so the shipped build refuses to pay at all and the
person completes payment themselves; `payment-authority.test.ts` and `booking-capability.test.ts`
cover the flag gate, the checks, and the **SIGKILL row** — a payment interrupted between the
journal's intent and its result leaves exactly one side effect, refuses to retry
(`DanglingIntentError`), and settles by asking the merchant.

The `execute_payment`, `fill_saved_field` and `request_profile_grant` tools reach the agent through
the new product-neutral `EnvironmentConfig.hostTools` hook (`core/test/host-tools.test.ts`), and are
offered only when a broker is present — absent in `penguin web` and the CLI. The tools carry the
turn, conversation and (preferentially) the page from the host, not from the model's arguments
(`server/test/vault-tools.test.ts`).

## 7. The disabled state is visible (004 §5)

`GET /api/capabilities` reports the resolved flags with the denial sentences unedited, plus whether
a shell is present and any misconfiguration. The Vault settings tab renders it: on / denied / off,
with the reason shown on a denied row so "the vault will not start because Linux has no keyring" is
never indistinguishable from "there is no vault feature" (`capabilities-route.test.ts`,
`web/test/capability-model.test.ts`).

---

## 8. Test coverage

Run per package from the repository root:

```
pnpm --filter @travel-agent/transaction       exec vitest run
pnpm --filter @travel-agent/domain            exec vitest run
pnpm --filter @prismshadow/penguin-core       exec vitest run
pnpm --filter @prismshadow/penguin-server     exec vitest run
pnpm --filter @prismshadow/penguin-web        exec vitest run
pnpm --filter @prismshadow/penguin-desktop    exec vitest run
pnpm --filter penguin-browser                 run test         # serial; see the baseline note
pnpm -r exec tsc --noEmit -p tsconfig.json
pnpm -r run build
pnpm format:check
```

| Suite | Covers |
| --- | --- |
| `transaction/test/capability.test.ts` | The P4 matrix at the capability layer: bound to the displayed digest; opaque method ref (token/PAN refused); expiry, used, domain mismatch, over-ceiling, unapproved rise; the journal key naming the purchase, not the capability |
| `travel-domain/test/booking-capability.test.ts` | The fifth check in order; a payment with no capability refused; pay-at-counter still allowed; wrong turn/domain/price refused; **pay-once across a restart** and the SIGKILL → one-side-effect → refuse-retry → reconcile sequence |
| `desktop/test/vault-crypto.test.ts` | Round-trip; no plaintext on disk; AAD binding (field swap refused); wrong key/version/size refused; field-level DEK isolation; key wipe |
| `desktop/test/vault-tiers.test.ts` | The default table; L1/L2/L3 boundaries; unknown → L2; the storage fail-closed rule including A9 |
| `desktop/test/vault-audit.test.ts` | No values (grep after a whole flow); the hash chain reporting edit / deletion / truncation / reorder (A10); locked-vault refusal; torn-line tolerance |
| `desktop/test/vault-store.test.ts` | Create-on-first-use; reopen; corrupt/unknown-version/locked-keychain refusals; L3 never stored; per-field keys; project/reveal/export/rotate; the audit trail |
| `desktop/test/vault-grants.test.ts` | **The rejection matrix** — the seven refusals, each by reason; TTLs; revocation on turn-end and lock; domain normalisation |
| `desktop/test/vault-secure-fill.test.ts` | Value into the page and nowhere else; grant/domain/turn/lock/element/fill-failure refusals; never-filled fields; every refusal audited by reason |
| `desktop/test/vault-secret-phase.test.ts` | Detach-before-fill; fail-closed detach; the three exits; proof required to reattach; live-fill gate off by default; unaskable page → unproven |
| `desktop/test/debugger-fill-port.test.ts` | Isolated-world write; value as argument not source; framework events via the native setter; held-session not torn down; missing tab handled |
| `desktop/test/broker-server.test.ts` | A3 (no/forged token); three ops only, unknown field refused, value-not-handle refused; A4 bindings passed through unchanged; handler refusal vs throw; rate limit; audit without payload |
| `desktop/test/broker-handlers.test.ts` | A4 at the layer that answers it: the claimed domain compared to the page main reads, mismatch refused and audited; grant ask/approve/decline/narrow; fill and pay refusals passed back by reason |
| `desktop/test/payment-authority.test.ts` | Issue hands back an id not a permission; the flag gate; credential resolved in main and wiped; every capability check; **the SIGKILL row** with a side-effect count |
| `desktop/test/pane-target-resolver.test.ts` | The pane↔vault adapter's edges: gone tab → null; fail-closed detach of a missing target; drive-gate revoke/restore |
| `desktop/test/browser-pane-behaviour.test.ts` (Phase 4 additions) | `taskTargetId` resolving a turn's `"current"` target and returning null (fail-closed) for a turn with no live tab or another turn's; the secret-phase drive gate revoke/restore and `closeTarget` |
| `desktop/test/vault-shell-gating.test.ts` | The gating chain: usable storage + no isolation → L1 on, L2/L3/live/pay off with reasons; A9 → vault off entirely; the secret_entry.live ordering |
| `desktop/test/vault-redaction-agreement.test.ts` | Golden shape/fingerprint values shared with the relay, so the two implementations cannot drift apart silently |
| `browser-cli/src/redaction.unit.test.ts` | Text replacement wherever a value is echoed; digit-run boundary; same-shape non-match; screenshot allowed/refused by box coverage; the golden pair |
| `core/test/host-tools.test.ts` | Host tools listed, executable, permissioned; refused when they shadow a built-in; absent when none offered |
| `server/test/vault-tools.test.ts` | Three write tools, or none without a shell; fill takes a handle not a value; turn/session from the host not the model; refusal vs transport error; no personal value in what is sent or returned |
| `server/test/broker-client.test.ts` | Dial/frame/answer; refusal as a value, broken channel as a throw; absent for a standalone server; strict parsing |
| `server/test/capabilities-route.test.ts` | Everything off by default; a requested-but-denied capability reported with its reason (the 004 §5 chain); misconfiguration surfaced; nothing secret; login required |
| `web/test/capability-model.test.ts` | on / denied / off kept distinct; only denied carries a reason; unknown flag still rendered; the summary and misconfiguration lines |

**Counts at this commit**, from the commands above:

| Gate | Result |
| --- | --- |
| transaction | 143 passed (143) |
| travel-domain | 59 passed (59) |
| core | 877 passed, 5 skipped (882) |
| server | 711 passed (711) |
| web | 765 passed (765) |
| desktop | 674 passed (674) |
| desktop e2e (Electron + Xvfb) | iab-e2e: all assertions passed (exit 0) |
| browser-cli (`pnpm test`, serial) | 542 passed, 6 failed (the pinned-Chromium baseline), 1 skipped (549); exit 1 — see below |
| typecheck (`tsc --noEmit`, all packages) | clean, all packages |
| build (`pnpm -r run build`) | clean, all packages |
| `pnpm format:check` | clean |

**The `browser-cli` baseline.** That package's gate (`vitest run --no-file-parallelism`, run alone)
exits **1**, and the exit code is not the thing to read: `Test Files 2 failed | 43 passed (45)`,
`Tests 6 failed | 542 passed | 1 skipped (549)`, where the two failed files are the two that hold
those six tests. They are the pinned-Chromium baseline recorded in `phase-00.md` §3 and carried
through every phase since, name for name — five `Relay Core Tests` and
`Snapshot & Screenshot Tests > should capture screenshot correctly`. This phase added the 13-test
`redaction.unit.test.ts` (529 passed in phase 3 → 542 here); the skip and failure sets are
unchanged, and no new failure appeared. The counts above for the other packages are all clean at
this commit.

---

## 9. Explicit non-goals

Each is assigned elsewhere; none is a stub pretending to be a feature.

1. **Enabling real L2/L3, live secret fill, or agent payment.** All three stay off, gated on the
   agent-runtime isolation of 003 §0.3, which is Phase 5. The machinery is complete and tested with
   dummy fixtures; the flags are what stay down.
2. **The OS-level isolation itself (003 §0.3, attacks A1–A7).** Phase 5's security track. This phase
   *consumes* an isolation probe result; it does not implement isolation, and it never reports the
   probe true.
3. **OCR redaction fallback (`redaction.ocr`).** Off, best-effort by design, Phase 5+. The text and
   bounding-box paths are complete; the "same value re-rendered as pixels elsewhere" case is the one
   OCR would address, and 003 §6.5 already says OCR offers no guarantee.
4. **The merchant side of a real payment.** `PaymentPort` is an interface; the shipped build wires
   `notConfiguredPaymentPort`, which throws. Wiring a real merchant/PSP path is Phase 5 work behind
   `payments.execute`.
5. **A per-field grant card.** The grant ask is an all-or-nothing native dialog this phase; the
   per-field card belongs with the interaction cards and is deferred.

## 10. Known limitations

- **The grant dialog is modal and coarse.** It names the site, purpose and fields, and a person
  decides yes/no on the whole set. It cannot yet narrow the set — that is the per-field card above.
- **Peer-credential UID checks on the broker socket are not claimed.** Node exposes no portable
  `SO_PEERCRED`/`getpeereid`, so the enforcement is the 0600 socket in a 0700 directory plus the
  token. 003 §11.2's UID check is a Phase 5 item where the platform allows it.
