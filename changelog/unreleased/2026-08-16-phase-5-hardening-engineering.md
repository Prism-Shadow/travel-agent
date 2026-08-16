# Phase 5 (hardening): crashes, logs and metrics that keep the no-value promise

The vault, the interaction layer and the broker all refuse to write a personal value down. Phase 5's
engineering track extends that same promise to the places a value leaks when things go *wrong* — a
log line, a crash report — and adds the gauges that tell whether the agent-first design is actually
working. None of it enables a capability; it makes failure and observation safe and honest.

## What changed

- **Secrets are scrubbed before anything is logged or reported.** A shared redactor recognises the
  shapes a credential takes — tokens, bearer headers, `PENGUIN_*` env secrets, real (Luhn-valid)
  card numbers, and any value filed under a secret-named key — and replaces them with a
  `[REDACTED:…]` marker, while leaving the structure you read a log *for* intact. It is careful in
  both directions: an opaque vault handle (`pv:…`) is left alone because it is safe to log, and a
  card number is only redacted when it passes a Luhn check, so this app's own long id timestamps are
  not shredded.

- **A crash in any of the three processes is recorded, with no values.** The main process, each
  in-app browser view, and the server's own process now write a local, structured crash report —
  what crashed, where, and why, scrubbed through the redactor — instead of a memory dump that could
  contain anything. Recording is not swallowing: an uncaught error is still re-surfaced afterwards,
  and the reporter is built so a failure to write a report can never itself escalate the crash.

- **Three design signals are now measurable.** How often the agent falls back to handing you the
  whole browser, how often a flow reaches a one-time-code step, and how often a spoken "yes" was
  sent back to the confirmation card — each reported with its raw counts and a rate that stays "—"
  until there is enough data to mean something, read at a new metrics endpoint. These are the dials
  for tuning whether the assistant interrupts too much or too little.

- **The in-app browser's recoveries speak one language.** A relay crash, an extension disconnect, an
  in-app view dying, a failed restore — each now maps to a single status vocabulary that says
  whether it fixes itself or needs you, so a silent recovery stops being indistinguishable from a
  hang.

## Honest edges

- Enabling real personal data, live one-time-code fills, and agent payments still waits on OS-level
  isolation of the agent runtime — the security half of this phase, which is a decision (which
  isolation approach, on which platforms) rather than a module. Its options and the fail-closed
  stance are written up in `docs/verification/isolation.md`; until it lands, those capabilities stay
  off exactly as before.
- The card-fallback metric is wired and tested but has no live source yet (the natural-language
  confirmation path is not connected), so it reads "—".
- The recovery-status vocabulary is delivered and tested; rendering it from every existing handler
  is a small follow-up.

## For developers

- `redactSecrets` / `redactDeep` in `@prismshadow/penguin-core`; `crash-reporting.ts`,
  `recovery-status.ts` in desktop; `metrics/observability.ts` + `GET /api/metrics` in the server.
  All the decision logic is pure and unit-tested. Phase 5's other slice — the CI security guards —
  shipped in the preceding checkpoint.
