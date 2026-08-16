# Phase 6 (beta): your data survives an upgrade — and a rollback

A Beta channel means two versions of the app now share the same files on disk: you update, and if
something is off you roll back. The danger in that is quiet — an older build opening a file a newer
one wrote, deciding it "doesn't recognise it", and dropping your saved details or your open tabs.
This makes that impossible to do silently.

Every file the app keeps in your profile — the private vault, the restore-your-tabs checkpoint — now
carries two markers: the version it was written at, and the oldest version of the app that can still
read it. From those, the app does the obvious right thing in each direction:

- **Opening an older file**: it is migrated forward to the current format, then used.
- **Opening a newer file after a rollback**: if the newer version only *added* things, the older app
  reads it and ignores what it does not know — your data comes back. If the newer version changed
  something fundamentally, the older app says so plainly and refuses to touch the file, rather than
  half-reading it. For the vault — where a wrong read is a security problem, not an inconvenience —
  that refusal is the deliberate, safe default.

The net effect: a rollback stops being a gamble with your saved information.

## Honest scope

This ships the *machinery* and one real integration (vault + tab checkpoint), fully tested. The
formats are still at their first version, so there is no migration step to run yet — the framework
is in place before the first format change needs it, which is exactly when retrofitting it would be
painful. The rest of Phase 6 — signed installers on all three platforms, the actual
upgrade/rollback over a published release, and the per-platform input-method and screen-reader
passes — is release-and-hardware work, tracked in `docs/verification/phase-06.md`.

## For developers

- `packages/desktop/src/data-migration.ts`: a small, pure framework — `openDocument` (migrate
  forward / read a compatible newer file / refuse) and `stampDocument` (write `version` + `compat`),
  with a registry of document kinds. Fully unit-tested against a synthetic multi-version schema.
- Wired into `tab-lifecycle.ts` (checkpoint) and `vault/store.ts` (vault); a test pins each kind's
  `current` to the store's own version constant so the two cannot drift.
- Reviewed the 001 §3 note about the installer's `packages/landing` reference: it is a live test of
  the install-forwarder, not a leftover, and is kept.
