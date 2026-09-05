# Agent Note: Traveler administrator identity with preserved account data

Status: implemented.

## Problem

The consumer product needs a travel-related sign-in identity without separating its owner from
existing Trips, conversations, settings or unsent browser drafts. A username is also a foreign
key and a browser-storage namespace, so changing only the seed would leave existing installations
on a different identity from fresh ones.

## Decision

The built-in administrator is `traveler`; the inherited PenguinHarness `admin` is retired. This is
a deliberate change to the inherited authentication baseline. The implementation lives in
[`server`](../../../packages/server/SPEC.md) and its cached-draft counterpart in
[`web`](../../../packages/web/SPEC.md).

Database opening applies a single transaction to the privileged legacy account and every user-id
reference, including schedule creators. It preserves the password hash, initial-password flag,
record ids and filesystem paths; it revokes the renamed account's login sessions. An occupied
`traveler` identity stops the upgrade without transferring ownership or privileges. New account
creation reserves the retired name `admin`. There is no alias or general-purpose account-renaming
API.

An optional previous-user marker distinguishes the migrated account from a fresh administrator.
The browser uses it before mounting draft consumers, copies account-scoped drafts without
overwriting destination data, and records completion. Copy failures preserve the source for retry;
conflicts preserve both values. Stale tabs cannot reintroduce completed drafts after migration.

Fresh installations seed the fixed initial password decided in
[fixed initial credentials](2026-09-05-fixed-initial-credentials.md). The environment override and
desktop token authentication retain their contracts; an upgrade never resets an existing password.

The upgrade is one hop, `admin` -> `traveler`. During development the identity briefly went
through `travel`, and the branch carried a two-hop chain with both retired names reserved; that
intermediate name never shipped, so before merge the chain was collapsed and `travel` is an
ordinary username again. Data roots that were on `travel` existed only on the author's machine
and were migrated by hand.

## Alternatives considered

- Change the seed only: leaves existing installations and their data under `admin`.
- Keep an `admin` login alias: contradicts the selected retirement of that login identity.
- Create a second administrator and copy its data: introduces duplicate ownership and separates
  existing references from their original records.
- Move storage directories with the username: changes paths that sessions and user artifacts
  already reference, although project and session ids do not need to change.
- Keep the two-hop `admin` -> `travel` -> `traveler` chain: reserves a username for an identity
  no released version ever had, and encodes a branch's history into every future installation.

## Consequences

Existing web sessions require a new login. Browser drafts migrate per origin on that origin's next
authenticated visit. A conflicting `traveler` account requires operator resolution before startup;
accounts are never silently merged. Existing non-administrator users, including an unrelated
non-privileged `admin`, retain their identity. The previous-user marker remains available for
browsers that visit later; it grants no authorization.

## Testing

Server tests exercise fresh seeding, retained passwords and initial flags, ownership and membership,
preferences, schedule creators, unchanged Trip and Session files, old-session rejection, desktop
sign-in, password updates, repeated opening, conflict rejection, transactional rollback and the
reserved name. Web tests exercise all three draft namespaces, fresh-account isolation, an unknown
previous identity, destination conflicts, storage failure and stale-tab replay prevention.
