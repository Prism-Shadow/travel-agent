# The port table describes this repository, not upstream's

`packages/core/src/internal/ports.ts` carried upstream PenguinHarness's port allocation, three
rows of which name packages this fork does not have. The comment calls itself "the one place a
reader looks for it", so being wrong there is expensive — it produced a confidently wrong answer
about `pnpm dev:docs` before anyone checked whether the package existed.

Details:

- Removed: 7366 `pnpm dev:landing`, 7367 `pnpm dev:docs`, 7369 `pnpm penguin web`. There is no
  `packages/landing`, `packages/docs` or `packages/cli` here, no such scripts in any
  `package.json`, and no code anywhere referencing those numbers. A closing note says upstream
  allocates them, so the next reader who meets them elsewhere is not left guessing.
- Corrected: the header claimed a CLI (`penguin server` / `penguin web`) as the constant's
  consumer. In this fork `DEFAULT_SERVER_PORT` has exactly one, `packages/server/src/config.ts`.
- Added: the desktop app, which was absent from a table meant to be exhaustive even though it is
  the product. It binds an ephemeral port and announces the real one through its port file,
  which is *why* it never collides with a development run.

Comment-only: `DEFAULT_SERVER_PORT = 7364` and every other line of code are untouched, and the
core suite is unchanged (898 passing).

This edits `packages/core`, a pinned engine snapshot, and is therefore a deliberate decision
rather than a side effect (root `AGENTS.md`, Hard Rule 3): a navigational comment that sends
readers of *this* repository to directories it does not contain is a defect in this repository,
and the fix changes no engine behaviour. One upstream mention of `penguin web` remains in
`core/src/environment/tools/command/session-manager.ts`, where it illustrates environment-variable
handling rather than directing anyone anywhere; it is left alone.
