# Browser CLI sources grouped by concern, and tests out of the published package

`packages/browser-cli/src` was one flat directory of 117 entries: 68 modules, 44 tests, two
markdown files and three generated folders, with nothing distinguishing four different kinds of
thing from each other. It is now grouped — `relay/`, `executor/`, `page/`, `browser/`, `media/`,
`cursor/`, `mcp/`, `shared/`, plus `client/` and `examples/` — with the four entry points
(`cli.ts`, `mcp.ts`, `index.ts`, `start-relay-server.ts`) left at the root. `src/README.md` is the
map.

The dependency graph was already sound and is unchanged: `shared/utils` remains the hub, nothing
moved between layers, and no module was deleted or merged.

## What the grouping made visible

**Tests were being published.** `tsconfig.json` has `include: ["src"]`, so the 44 test files in
that directory were compiled into `dist/` and shipped with the package — 185 test artifacts, and
the 44 sources too, since `files` lists `src`. Tests moved to `test/` (where two of them already
lived), leaving 4 build outputs matching `test` instead of 185. New `tsconfig.test.json` keeps
them type-checked without emitting; `pnpm typecheck` now runs both projects, so `test/` is checked
for the first time — which immediately surfaced three real type errors in `test/security.test.ts`.

**Nine files computed package paths by counting directories.** `path.join(__dirname, '..', 'dist',
…)` was correct only because every module sat directly under `src/` and every output directly
under `dist/`, where `..` meant the package root from both. One level down, all nine silently
resolved to `src/dist/…`. They now use `packageRoot()` / `distPath()` from
`shared/package-paths.ts`, which walks up to the nearest `package.json` and gives the same answer
at any depth. `package-paths.ts` had the same bug in its own root lookup.

**The tsc exclusion for page-side bundles was a list of filenames.** `a11y-client.ts`,
`ghost-cursor-client.ts` and `help-overlay-client.ts` run in the page and use DOM globals this
package deliberately has no `dom` lib for; they were excluded by name. Moving them broke the
exclusion and pulled them into a compilation that could not type them. The rule is now the
directory: `src/client/**`.

## Callers updated in the same change

`packages/browser-extension` deep-imports `src/relay/cdp-types`, `src/relay/protocol` and
`src/browser/ghost-browser`; the two build scripts reference the client-bundle entries, the example
sources and three generated `.d.ts` paths. Because the workspace uses `injectWorkspacePackages`,
the extension resolves a *copy* of this package, so `pnpm install` must re-run before its build
sees a layout change — worth knowing before the next move.

Verification: 46 test files, 572 passed and 6 skipped — identical to the pre-change baseline; both
typecheck projects clean; `browser-cli` and `browser-extension` both build; the extension's own 9
tests pass.
