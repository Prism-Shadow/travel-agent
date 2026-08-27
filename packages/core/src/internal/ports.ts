/**
 * Default server port (internal shared constant; the barrel re-exports only
 * DEFAULT_SERVER_PORT, so the number lives in one place rather than being hardcoded by each
 * consumer). It is a fallback only: the PORT environment variable overrides it at runtime.
 */

/**
 * Port allocation **in this repository** (documented here because it is the one place a
 * reader looks for it; the dev ports themselves live in vite configs and package.json
 * scripts, neither of which can import this module):
 *
 * | port | who                             | where                                  |
 * | ---- | ------------------------------- | -------------------------------------- |
 * | 7364 | server default                  | `DEFAULT_SERVER_PORT` below            |
 * | 7365 | `pnpm dev:web` (Vite)           | `packages/web/vite.config.ts`          |
 * | 7368 | `pnpm dev:server` (dev backend) | `packages/server/package.json` `dev`   |
 *
 * The desktop app is deliberately absent from the table: it binds an **ephemeral** port (0,
 * chosen by the OS) and announces the real one through its port file, precisely so that a
 * packaged install never collides with a development run.
 *
 * The development backend deliberately does **not** share 7364: the two are routinely
 * running at once, and before they were split, `pnpm dev` either failed to bind or -- worse
 * -- the Vite proxy silently talked to the other server instead of the one being worked on.
 * The dev data root is separated for the same reason.
 *
 * Upstream PenguinHarness also allocates 7366 / 7367 / 7369 to a landing site, a docs site
 * and a `penguin` CLI. This fork has none of those packages, so those rows are not listed:
 * a reader who found them here went looking for `packages/docs` and did not find it.
 */

/** Default main server / Web UI port; deliberately avoids common defaults like 3000/8080. */
export const DEFAULT_SERVER_PORT = 7364;
