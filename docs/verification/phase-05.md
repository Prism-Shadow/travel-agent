# Phase 5 verification — hardening, the engineering track

Phase 5 has two tracks (design/004 §2.1). This document covers the **engineering track** — the
GA-required work that does not depend on OS isolation — which is code-complete. The **security
track** (agent-runtime isolation, decision point D3, attacks A1–A7) is a separate, still-open gate;
its verdict is recorded in [`isolation.md`](./isolation.md), and until it is met the real L2/L3,
live-secret-fill and payment capabilities stay off exactly as Phase 4 left them.

Companion human half: [`../manual-testing/phase-05-hardening.md`](../manual-testing/phase-05-hardening.md),
entirely `PENDING`.

The through-line of this track is 003 §4.6's invariant — **no values** — extended from the vault to
everything the app writes down when something goes wrong: a log line, a crash payload, a metric.
Nothing here enables a capability; it makes the failure and observation surfaces safe and honest.

---

## 1. The debug-port leak is a build failure (002 §11.2)

Delivered in the preceding checkpoint (`chore(hardening): CI guards…`), recorded here for the
phase's completeness. Two guards: a source scanner (`check-debug-switches.mjs`, ordinary CI) that
fails the build on a `--remote-debugging-port`/inspector switch *used* in shipped code, telling use
from mention; and a fuse guard (`apply-fuses.mjs` afterPack + `check-fuses.mjs`, packaging workflow)
that flips `RunAsNode`/inspector fuses off in the packaged binary and verifies them. Pure logic in
`security-guards.mjs`, unit-tested (`desktop/test/security-guards.test.ts`).

## 2. Secret-shape redaction (003 §4.6)

`redactSecrets` / `redactDeep` in core scrub secret-*shaped* strings — tokens, bearer headers,
`PENGUIN_*` env secrets, Luhn-valid card numbers, values under secret-named keys — out of any string
or structure before it is logged or reported. It is honest about being a heuristic (the real rule is
that values are not supposed to reach a log; this is defence in depth) and about erring toward
redaction, with two calibrations that keep it useful: a `pv:` vault handle is left alone (an opaque
reference, safe to log), and the card rule uses a Luhn check so this system's own 13-digit task-id
timestamps are not shredded as PANs. Pure, in core so every layer can use it; tested in
`core/test/secret-redaction.test.ts`.

## 3. Crash reporting, three layers, no values (004 Phase 5)

`crash-reporting.ts` records a crash in each of the shell's three processes — main
(`uncaughtException`/`unhandledRejection`), renderer (`render-process-gone`, the window and every
in-app browser view), and the utilityProcess the server runs in (`child-process-gone`) — as a
**local, structured, value-free** JSONL report. Electron's own `crashReporter` uploads minidumps to
a server that does not exist here and a minidump can contain anything in memory; this writes only
metadata (layer, event, reason, versions), and every string passes `redactSecrets` first, so an
exception message that quoted a request or a stack frame that carried an env dump lands scrubbed.
Recording is not swallowing: an uncaught main exception is re-surfaced after it is recorded. The
report builder is pure and tested against dirty input; the sink never throws (a crash reporter that
crashes the crash is the worst outcome). `desktop/test/crash-reporting.test.ts`. Wired in `main.ts`
before anything else in `whenReady`.

## 4. Observability rates (003 §13)

`ObservabilityMetrics` in the server keeps the three *design* signals 003 §13 asks to be watched:
the **takeover rate** (§13-8 — how often the agent falls back to handing over the whole browser),
the **secret-phase rate** (how often a flow reaches a one-time-code step), and the **card-fallback
rate** (§8.4 — how often a spoken "yes" was not accepted and the card was shown). Each is reported
with its raw counts and a `rate` that is `null` until the denominator crosses a floor, so a caller
shows "—" rather than "100%" off one event. Fed by the interaction service (every card raised),
read at `GET /api/metrics`. Pure arithmetic, tested in `server/test/observability.test.ts`.

**One honest gap.** The card-fallback rate has no live feeder yet: the natural-language confirmation
judge (`judgeConfirmationReply`) is not wired into a live server path — cards are the shipped
confirmation route — so its denominator stays 0 (the rate reports `null`). The counter and the
endpoint exist and are tested; the rate will populate when the spoken-confirmation path is wired.
Recorded rather than shown as a working metric that is really always zero.

## 5. Unified in-app-browser recovery status (002 §11.2)

`recovery-status.ts` gives the four ways the in-app browser fails under a person — the relay
crashing, the extension disconnecting, an in-app view's renderer dying, a failed restore — one
vocabulary: a status with a mode (`recovering` / `degraded` / `manual`), i18n string keys for the
title and next step, and an `autoRecovering` flag so a self-healing crash shows a spinner rather than
a button. `classifyRecovery` maps the shell's own `IAB_*`/`render-process-gone`/relay/extension
codes to a failure and returns null for anything that is not one of these, so an unrelated error is
never dressed up as a browser-recovery status. Pure and tested
(`desktop/test/recovery-status.test.ts`). The canonical mapping is delivered; wiring each existing
handler to render it is a small follow-up noted in §8.

---

## 6. Test coverage

| Suite | Covers |
| --- | --- |
| `desktop/test/security-guards.test.ts` | The debug-switch scanner (use vs mention, help-string scope, allow marker) and the fuse-state diff (each fuse wrong, removed byte, absent, asar exception) |
| `core/test/secret-redaction.test.ts` | Env/JSON/bearer/PAN/opaque-token redaction; the Luhn calibration that spares task-id timestamps; the `pv:` handle exception; deep redaction with depth and cycle bounds |
| `desktop/test/crash-reporting.test.ts` | The value-free report (a secret on an exception message and a stack frame scrubbed); the capped stack; the never-throw sink; the three layers reaching the sink; an uncaught exception re-surfaced, not swallowed |
| `server/test/observability.test.ts` | The three rates' arithmetic; the small-sample floor that withholds a rate; an unknown kind not miscounting the denominator; fallback counted over attempts |
| `desktop/test/recovery-status.test.ts` | Each failure's mode matching how it resolves; distinct string keys; the classifier recognising the shell's codes and refusing unrelated ones |

**Counts at this commit:**

| Gate | Result |
| --- | --- |
| core | 891 passed, 5 skipped (896) |
| server | 717 passed (717) |
| desktop | 708 passed (708) |
| transaction | 143 passed (143) |
| travel-domain | 59 passed (59) |
| web | 765 passed (765) |
| typecheck (all packages) | clean |
| build (all packages) | clean |
| `pnpm format:check` | clean |
| debug-switch guard | clean (664 source files) |

The web, transaction and travel-domain suites are unchanged by this track and their counts stand
from Phase 4. The browser-cli serial gate is likewise untouched (its pinned-Chromium baseline is
recorded in `phase-04.md`).

## 7. Explicit non-goals

1. **The security track — OS-level agent isolation (003 §0.3, attacks A1–A7).** The other half of
   Phase 5, and the gate that L2/L3, `secret_entry.live` and `payments.execute` wait on. It is a
   selection-and-implementation decision (D3), not a module to write here; the verdict and options
   are in [`isolation.md`](./isolation.md). This track deliberately ships without it, and the gated
   capabilities stay off.
2. **A remote crash/audit sink.** Reports are local JSONL. 003 §5.3 leaves an append-only remote
   sink to after GA; the no-value invariant is what makes a future forward safe, and it holds now.
3. **OCR redaction fallback (`redaction.ocr`).** Still off, still Phase 5+, unchanged from Phase 4.

## 8. Known limitations

- **The card-fallback metric has no live feeder** (see §4): it is tested and exposed but reports
  `null` until the natural-language confirmation path is wired.
- **The recovery-status vocabulary is delivered but not yet rendered by every handler.** The mapping
  and `classifyRecovery` are complete and tested; the relay-restart, extension-disconnect and
  renderer-rebuild paths still show their existing ad-hoc states. Converting each to emit the
  unified status (and adding the `browser.recovery.*` strings to the web table) is a contained
  follow-up.
- **The web string keys the recovery status names** (`browser.recovery.*`) are not yet in the string
  tables; they are added when the render wiring above lands, so a partial wiring cannot show a raw
  key.
