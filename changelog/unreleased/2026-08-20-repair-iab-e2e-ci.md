# CI: the in-app browser e2e is repaired — two breakages that landed without a completed run

Main's CI had been red since the first completed run today; the e2e step was broken twice over by
commits that were never validated individually — yesterday evening's commits were pushed as one
batch this morning, and that batch's run was auto-cancelled by the next push, so the next completed
run surfaced both at once under an unrelated author.

- **Stale flat path (broken by the 2026-08-19 `src/` regrouping, `c791432`).**
  `packages/desktop/e2e/iab-e2e.cjs` imported `browser-cli/dist/cdp-relay.js`; the compiled file
  lives at `dist/relay/cdp-relay.js` since the regrouping. The regrouping's own sweep grepped
  `penguin-browser/dist/` — the package-name spelling — and this harness references the package by
  directory name, so it escaped. A repo-wide enumeration of every `…/dist/…` deep reference
  against the actual build tree found exactly this one stale path; the grep lesson in
  `tasks/lessons.md` and `browser-cli/src/README.md` now names both spellings.
- **Missing redaction provider (broken by the redaction wiring, `53500ec`).** The transport
  refuses `iab-redaction-state` without a main-process provider — fail-closed, by design, and the
  design is untouched. The e2e harness constructs the real `IabTransport` but never passed the
  provider, so every ARIA snapshot was refused. It now answers `{ active: false }`, byte-for-byte
  the real main's response when no vault shell exists, which the executor decodes as "no
  redaction registry" and renders normally.

Verified: `pnpm --filter @prismshadow/penguin-desktop test:e2e` locally — all 19 assertions pass,
including the previously-refused ARIA snapshot and everything downstream of it.
