# Agent Note: Traveler administrator identity

Status: implemented.

## Problem

The consumer product needs a travel-related sign-in identity. The inherited PenguinHarness
baseline seeds its built-in administrator as `admin`, and that name appears in the login page, the
startup notice, the README and every place a person is told how to sign in for the first time.

## Decision

The built-in administrator is `traveler`. Fresh data roots seed that name with the fixed initial
password decided in [fixed initial credentials](2026-09-05-fixed-initial-credentials.md). This is a
deliberate change to the inherited authentication baseline; the implementation is the seed in
[`server`](../../../packages/server/SPEC.md) and the login page in
[`web`](../../../packages/web/SPEC.md).

There is no upgrade path from `admin`, no alias, and no reserved name. The product has not been
released and nothing has been installed, so no data root anywhere carries the old identity; the
only one that ever did was the author's development root, which was migrated by hand.

## Alternatives considered

- Keep `admin`: a generic name on a product whose every other surface says travel.
- Ship a legacy upgrade (`admin` -> `traveler`, moving ownership, memberships, preferences and
  schedule creators in one transaction, plus a browser-side draft migration keyed on a
  `previousUserId` marker): built during this work, then removed before merge. It served a
  population of zero, cost about four hundred lines of code and tests, and carried a failure mode
  — an existing ordinary user named `traveler` made the server refuse to start with no way to fix
  it short of editing SQLite by hand. If a population ever appears (a released build whose data
  roots hold `admin`), the git history of this branch holds a reviewed implementation to start
  from; the conflict case must be resolved before shipping it.
- A two-hop `admin` -> `travel` -> `traveler` chain: an intermediate name the branch went through
  during development; rejected for encoding one branch's history into every future installation.

## Consequences

`ADMIN_USER_ID` is `traveler` everywhere: seeding, desktop token sign-in, the startup notice and
the login page. Ordinary users may be named `admin` or `travel`; nothing treats those names
specially. The database schema has no identity-migration column.

## Testing

Server tests seed `traveler`, sign in with the fixed credentials, and resolve desktop token
sign-in to the same identity. The web browser suite signs in as `traveler` throughout.
