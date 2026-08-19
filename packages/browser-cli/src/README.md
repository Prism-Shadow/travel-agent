# Map of `src/`

One flat directory used to hold 117 entries — 68 modules, 44 tests, two markdown files and three
generated folders — with nothing to tell them apart. This is the map of what replaced it.

Tests now live in `../test/`, not here. That is not only tidiness: `tsconfig.json` has
`include: ["src"]`, so every test file in this directory was compiled into `dist/` and published
with the package (88 `.test.js` plus declarations and maps). They are type-checked by
`../tsconfig.test.json`, which emits nothing.

## Entry points, kept at the root

| File | Runs when |
| --- | --- |
| `cli.ts` | `penguin-browser …` — every command, via `bin.js` → `dist/cli.js` |
| `mcp.ts` | the MCP server an agent connects to |
| `index.ts` | the package is imported as a library (this is the public API surface) |
| `start-relay-server.ts` | the relay is started as its own process |

`skill.md` and `resource.md` sit beside them: they are the agent-facing instructions, read at
runtime by `cli.ts skill` and compiled into `dist/prompt.md` by `scripts/build-resources.ts`.

## The layers

| Directory | What lives there |
| --- | --- |
| `relay/` | The CDP relay and everything that is a fact about a connection: `cdp-relay` (the server), `relay-state` (one zustand atom), `protocol` / `cdp-types` (the wire), `relay-client`, `relay-discovery`, `session-lifecycle`, `tab-ownership`, `storage-cookie-routing`, `agent-identity`, `iab-key`, `extension-errors`, `cdp-session`, `cdp-log` |
| `executor/` | Running the agent's code and refusing what it must not do: `executor` (the vm), `interaction`, `write-gate`, `payment-gate`, `handover-state`, `request-help`, `user-interaction`, `sandboxed-process`, `scoped-fs`, `wait-for-page-load` |
| `page/` | Turning a page into something an agent can read: `aria-snapshot`, `page-markdown`, `clean-html`, `htmlrewrite`, `styles`, `react-source`, `editor`, `debugger` |
| `browser/` | Getting a browser to talk to: `browser-install`, `browser-launch`, `browser-config`, `chrome-discovery`, `playwright-import`, `ghost-browser`, `cloud-client`, `kill-port` |
| `media/` | `screen-recording`, `recording-relay`, `stream-relay`, `ffmpeg`, `kitty-graphics` |
| `cursor/` | `ghost-cursor`, `ghost-cursor-controller` — human-like pointer movement |
| `mcp/` | `mcp-resources` — the documents the MCP server serves |
| `shared/` | What anything may depend on: `utils` (the most-depended-on module here), `create-logger`, `package-paths`, `diff-utils`, `redaction`, `test-declarations` |

## Two directories that are not ordinary Node modules

**`client/`** — `a11y-client`, `ghost-cursor-client`, `help-overlay-client`. These run in the *page*,
not in Node. `scripts/build-client-bundles.ts` compiles each into an IIFE that is injected over CDP,
and `tsconfig.json` excludes `src/client/**` because they use DOM globals this package deliberately
does not carry a `dom` lib for. Putting a file here means "this is page-side code" — before the
grouping the exclusion had to name each file individually, and moving one silently pulled it into a
compilation that could not type it.

**`examples/`** — `debugger-examples`, `editor-examples`, `performance-examples`,
`styles-examples`, and their shared `debugger-examples-types`. Never executed and never imported by
anything that runs. `scripts/build-resources.ts` reads them as text to generate the API docs in
`dist/`. They are documentation that the type checker keeps honest.

## Finding the package's own files

Use `packageRoot()` / `distPath()` from `shared/package-paths.ts`. Do **not** write
`path.join(__dirname, '..', 'dist', …)`: that hard-codes how deep the asking file sits. It read as
correct for years only because every module was directly under `src/` (and every output directly
under `dist/`), where `..` meant the package root from both. Nine files did it, and grouping them
one level down turned all nine into `src/dist/…` at runtime — which no type checker can see.

## Extension contract

`packages/browser-extension` deep-imports three of these paths:

- `penguin-browser/src/relay/cdp-types`
- `penguin-browser/src/relay/protocol`
- `penguin-browser/src/browser/ghost-browser`

and inlines `dist/ghost-cursor-client.js` with vite's `?raw`. Moving or renaming any of them means
updating the extension in the same change — and because the workspace uses
`injectWorkspacePackages`, the extension sees a *copy* of this package, so `pnpm install` has to
re-run before its build can see the new layout.
