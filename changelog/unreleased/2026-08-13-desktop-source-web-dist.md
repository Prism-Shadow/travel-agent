# Desktop source runs serve the built Web app

`pnpm desktop` now tells its embedded server exactly where this checkout's Web build lives, so the successful one-shot Desktop login lands on the app instead of a JSON 404.

Source runs fork pnpm's injected copy of `@prismshadow/penguin-server` from `node_modules/.pnpm`. The server's package-relative monorepo fallback cannot reach `packages/web/dist` from that location, even though the Desktop preflight correctly verified that the build exists. The Desktop child-process environment now supplies the absolute development `PENGUIN_WEB_DIST`; packaged apps keep using their staged `web-dist`, and an explicit user override remains authoritative.
