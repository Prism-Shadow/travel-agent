# Travel administrator migration

The completed `admin` -> `travel` work below is followed by
[Traveler login identity](traveler-login.md), which owns the current username and local login.

Status: implemented and verified locally. The owner explicitly selected replacing the built-in
`admin` account with `travel`, preserving existing account data, with no `admin` login alias.
This is a deliberate change to the inherited authentication baseline.

## Scope and sequence

- [x] Stop this checkout's development backend and back up its development data root.
- [x] Seed `travel` on fresh installations and use `travel-<4 digits>` for printable random
      initial passwords. Keep the environment override and desktop token sign-in behavior.
- [x] Atomically migrate the legacy privileged account, project ownership, memberships,
      preferences and schedule creators. Preserve password hashes and initial-password flags.
      Invalidate its old login sessions; preserve project/session/trip ids and all directories.
- [x] Refuse a conflicting existing `travel` account rather than merging identities. Make
      migration idempotent and leave unrelated users untouched.
- [x] Carry a server-confirmed previous-user marker to the client so this browser's active,
      session and parked drafts can move to the new namespace without overwriting newer data.
- [x] Update login copy, tests and module contracts; record the identity decision.
- [x] Test fresh setup, upgrade, collision rollback, owner access, desktop sign-in, password
      updates and browser draft preservation. Run build, typecheck, package tests and browser QA.
- [x] Migrate the local development root, set its selected travel-themed password through the
      password API, and verify new login, rejected legacy login and unchanged saved data.

## Operational limits

Only `~/.penguin/dev-data` is an authorized local migration target. Installed-user state is not
touched. The local password is an acceptance credential, not a universal product default.
Backups and verification evidence stay in gitignored `artifacts/admin-migration/`.

## Verification

- `pnpm build`, `pnpm format:check`, `pnpm typecheck` and `git diff --check` pass.
- `pnpm test`: 3,900 pass, 6 pre-existing skips across the workspace.
- Web browser suite: 51 cases pass on the full run; the administrator-list assertion requires
  the adjacent initial-password badge in the accessible cell name. Its corrected focused rerun
  passes, covering all 52 cases across the two runs.
- Desktop browser end-to-end assertions and the debug-switch guard pass.
- The migrated local database has one `travel` administrator, 50 conversations and 2 Trips.
  Ownership and preferences match the backup after identity translation, all 647 backed-up
  regular data files match byte-for-byte, and SQLite integrity and foreign-key checks pass.
- New credentials sign in successfully; the retired username and previous password return 401.
  The existing browser draft cache moves intact, and both Trips and conversation history remain
  accessible through the real UI. Local acceptance credentials are recorded in
  [AGENTS.md](../AGENTS.md#local-browser-qa-login).
- Acceptance frontend: `http://localhost:7465`; backend: `http://localhost:7468`.
