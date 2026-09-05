# Traveler login identity

Status: complete. The two-hop chain below was collapsed to a single `admin` -> `traveler` step
before merge, and `travel` is no longer reserved: that name never shipped, and the only data roots
that carried it were this machine's. The current contract is
[the identity decision](../docs/decisions/implemented/2026-09-05-traveler-administrator-identity.md).

The owner selects `traveler` and `traveler-2026` for the local acceptance account. The built-in
username follows that identity; fresh installations retain the existing random-password policy.
This extends the deliberate inherited authentication change recorded in the account decision.

## Plan

- [x] Stop the local development backend and back up its data and browser draft caches.
- [x] Extend the atomic identity upgrade through `admin` -> `travel` -> `traveler`, rejecting
  occupied targets and preserving the original identity marker, references, passwords and paths.
- [x] Move browser drafts through the same chain, honoring prior completion markers and preserving
  destination conflicts. Reserve both retired names against new creation.
- [x] Update seed identity, login guidance, tests and owning specs. Record the superseding decision.
- [x] Verify upgrades, rollback, fresh seeding, desktop sign-in, browser draft continuity and login.
- [x] Migrate the local development data, set the selected password through the account API,
  verify preserved records/files, and restore the acceptance service on ports 7465/7468.

Evidence and the offline backup live in gitignored `artifacts/traveler-login/`.

## Verification

- Workspace build, typecheck and formatting checks pass.
- Server unit tests: 717 passed. Web unit tests: 793 passed.
- Web browser end-to-end suite: all 52 tests pass.
- Desktop in-app browser end-to-end assertions pass.
- New login and administrator access return 200; changing the password returns 204.
  Both retired names and the old password return 401.
- The local database retains one administrator, one Project, 50 conversations and 2 Trips.
  Related rows differ only in the intended identity references; integrity and foreign keys pass.
  All 647 backed-up content files retain their hashes.
- Real Chrome sign-in succeeds through port 7465. The login page displays the selected pair,
  and its existing browser draft is byte-for-byte preserved under the new namespace.
