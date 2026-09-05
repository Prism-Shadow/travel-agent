# Agent Note: Travel administrator identity with preserved account data

Status: implemented — the username choice is superseded by
[Traveler login identity](2026-09-05-traveler-login-identity.md). The `admin` -> `travel` step
remains the first step of the atomic upgrade chain; this note records its original decision.

## Problem

The consumer product needs a travel-related sign-in identity without separating its owner from
existing Trips, conversations, settings or unsent browser drafts. A username is also a foreign
key and a browser-storage namespace, so changing only the seed would leave existing installations
on a different identity from fresh ones.

## Decision

The owner explicitly selects `travel` as the built-in administrator, migration of the existing
account and data, and retirement of `admin`. This is a deliberate change to the inherited
PenguinHarness authentication baseline. The implementation lives in
[`server`](../../../packages/server/SPEC.md) and its cached-draft counterpart in
[`web`](../../../packages/web/SPEC.md).

Database opening applies a single transaction to the privileged legacy account and every user-id
reference, including schedule creators. It preserves the password hash, initial-password flag,
record ids and filesystem paths; it revokes the renamed account's login sessions. An occupied
`travel` identity stops the upgrade without transferring ownership or privileges. New account
creation reserves the retired name. There is no alias or general-purpose account-renaming API.

An optional previous-user marker distinguishes the migrated account from a fresh administrator.
The browser uses it before mounting draft consumers, copies account-scoped drafts without
overwriting destination data, and records completion. Copy failures preserve the source for retry;
conflicts preserve both values. Stale tabs cannot reintroduce completed drafts after migration.

Fresh web installations retain random initial passwords with a `travel-` prefix. The environment
override and desktop token authentication retain their contracts. A machine-local acceptance
password is an operational setting, not a shared product default; upgrade itself never resets
an existing password.

## Alternatives considered

- Change the seed only: leaves existing installations and their data under `admin`.
- Keep an `admin` login alias: contradicts the selected retirement of that login identity.
- Create a second administrator and copy its data: introduces duplicate ownership and separates
  existing references from their original records.
- Move storage directories with the username: changes paths that sessions and user artifacts
  already reference, although project and session ids do not need to change.

## Consequences

Existing web sessions require a new login. Browser drafts migrate per origin on that origin's next
authenticated visit. Conflicting names require operator resolution before startup; accounts are
never silently merged. Existing non-administrator users, including an unrelated non-privileged
legacy name, retain their identity. The previous-user marker remains available for browsers that
visit later; it grants no authorization.

## Testing

Server tests exercise fresh seeding, retained passwords and initial flags, ownership and membership,
preferences, schedule creators, unchanged Trip and Session files, old-session rejection, desktop
sign-in, password updates, repeated opening, conflict rejection and transactional rollback.
Web tests exercise all three draft namespaces, fresh-account isolation, destination conflicts,
storage failure and stale-tab replay prevention.
