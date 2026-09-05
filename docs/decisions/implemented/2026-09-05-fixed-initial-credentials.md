# Agent Note: Fixed, public initial credentials

Status: implemented.

## Problem

A fresh installation had no way to sign in without reading the server console: the seeded
administrator received a random `travel-<4 digits>` password, printed at startup and persisted in
the data root until changed. Desktop never needed it (the shell signs its window in by token), but
every other first contact did — `pnpm dev` in a browser, the desktop shell attaching to an already
running server, a data root later opened with `penguin web`. The login page could only say "use
the password the server printed", which is instruction, not help, and the development workaround
(a git-ignored `.env.development.local` feeding a DEV-only hint) meant the page told the truth on
exactly one machine.

## Decision

The owner chooses fixed initial credentials for the product: username `traveler`, password
`traveler-2026`. They are a single constant, `INITIAL_ADMIN_CREDENTIALS` in the server's API
contract, so the seed, the startup notice, the login page and the README all show the same pair.
Every mode seeds it, desktop included: one rule, and a desktop data root opened later with
`penguin web` answers to the documented credentials.

What stays: the account carries `passwordIsInitial` until the password is changed, the web UI
shows its change-it banner, web mode re-prints the framed reminder on every start until then,
login throttling remains, and `PENGUIN_SEED_ADMIN_PASSWORD` still overrides the password for
tests and for a deployment that must not start on the public default.

What goes: random password generation, the desktop-only unprinted random seed, and the
`VITE_PUBLIC_LOGIN_*` development hint with its DEV gate — the page now shows the product value
unconditionally.

## What this gives up

A known default password is the `admin/admin` pattern. Until the owner changes it, anyone who can
reach the server signs in as the administrator with zero guesses: every process on the machine
over loopback, and the whole network if `HOST` is widened. Throttling protects nothing during that
window. The previous random seed made the loopback API unusable to a local process that had not
read the console; that property is gone. The owner accepts this for a product whose server binds
loopback by default and whose data root is readable by every local process anyway, in exchange
for a first sign-in that never depends on a console.

## Alternatives considered

- Keep the random seed and improve discoverability: the reminder already re-printed on every
  start; the remaining friction was the console itself, which this does not remove.
- Random seed, but show it on the login page while still initial: an unauthenticated endpoint
  revealing a live credential is strictly worse than a public constant, and it would still leave
  the desktop attach case without a value the page could name.
- Fixed default in web mode only, random in desktop: two rules for one product; a desktop data
  root moved to `penguin web` would silently not match the documentation.
- Force a password change on first sign-in: not declined, not done — the change-it banner is the
  current nudge, and a mandatory step is a later product decision.

## Consequences

`packages/web/.env.development.local` is no longer read; the file may be deleted. The web e2e
suite no longer pins `PENGUIN_SEED_ADMIN_PASSWORD` and signs in through the same seed path a real
installation uses. Existing data roots are untouched: the seed only runs on an empty users table,
and the administrator identity upgrade never resets a password. A server exposed beyond loopback
must change the password or set `PENGUIN_SEED_ADMIN_PASSWORD` before first start; the server
README says so.

## Testing

Server tests seed the constant, log in with it flagged initial, reject it once an override is
pinned, and check the constant against the password policy. The web browser suite asserts the
login page shows the pair and that the pair signs in.
