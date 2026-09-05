# Agent Note: Traveler login identity

Status: implemented — supersedes the username choice in
[Travel administrator identity](2026-09-05-travel-administrator-identity.md).

## Problem

The owner selects `traveler` as the login identity after using `travel`. Existing installations
and browsers may still carry either retired name, and must retain their data across both upgrades.

## Decision

The built-in administrator is `traveler`. The server applies `admin` -> `travel` -> `traveler`
inside one transaction before seeding. Each step moves the privileged source account and its
references, preserves its password and paths, and revokes its login sessions. Any occupied target
rolls back the entire chain. Ordinary users are untouched, and new creation reserves both retired
names. This extends the deliberate change to the inherited authentication baseline.

The account marker retains its earliest identity. Browser drafts follow the same chain before
consumers mount, honoring any completed step and preserving destination conflicts. An account
that originated as `travel` cannot inherit unrelated `admin` drafts. Per-step completion markers
prevent stale tabs from resurrecting consumed drafts.

The selected local acceptance password is applied through the existing password API and displayed
through the development-only login hint. Fresh data roots retain random `travel-<4 digits>`
passwords, the environment override and desktop token sign-in. An upgrade never resets a password.
The owning contracts are [server](../../../packages/server/SPEC.md) and
[web](../../../packages/web/SPEC.md).

## Alternatives considered

- Rename only the latest identity: leaves installations that skipped the first upgrade behind.
- Replace the original marker with the latest name: loses the origin of drafts on older browsers.
- Provision another account: separates the owner from existing records and cached drafts.

## Consequences

Renamed accounts sign in again. Data and file paths remain stable. Operator resolution is required
for conflicting identities; no accounts are merged. Local display credentials remain separate from
the seed policy and must be updated when the local password changes.

## Testing

Server tests cover both legacy entry points, preserved original markers, fresh seeding, desktop
sign-in, retired login rejection, references and files, destination conflicts and rollback after
the first step succeeds. Browser tests cover all draft namespaces, completed upgrades, isolation,
conflicts, storage failures and stale tabs. Local acceptance compares database rows and file hashes
against an offline backup, then checks API and browser sign-in with the selected credentials.
