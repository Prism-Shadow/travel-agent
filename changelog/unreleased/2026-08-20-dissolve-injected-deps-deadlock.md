# The injected-deps build deadlock is dissolved

Issue 0005 is closed: a browser-cli layout change now clears itself on the next `pnpm -r build`,
because the extension bundle is no longer built from inside browser-cli's own build — the sync
that repairs the injected copy lands between the two builds instead of being gated behind the one
build that could not succeed without it.

## The structure that deadlocked, and the one that replaces it

`injectWorkspacePackages` (which `pnpm deploy` — the desktop staging mechanism — requires
globally in pnpm ≥ 10, so it stays) hands browser-extension a hard-linked copy of browser-cli
that re-syncs only after a **successful** browser-cli build. browser-cli's build ran the
extension bundling as a nested step, and that step resolves `penguin-browser/src/…` against the
copy: after a layout change the nested step failed on the stale copy, the build exited non-zero,
and the sync never ran — every retry identical (docs/issues/0005, now closed).

Now:

- browser-cli's build is client bundles + `tsc` + resources only; the nested step and
  `scripts/build-extension-bundle.ts` are gone.
- browser-extension's own build produces both variants: `dist/` (user-loaded unpacked; opens the
  welcome page) and, via the new `scripts/build-packaged.ts`, `dist-packaged/`
  (`PENGUIN_BROWSER_OPEN_WELCOME_PAGE=0` baked in, for the Chrome the CLI launches). Total
  extension builds per full run are unchanged — the second build moved, it was not added. The
  packaged step skips itself when `PENGUIN_BROWSER_EXTENSION_DIST` is pinned (test builds drive
  one custom output).
- The preflight moved with it and keeps the residual trap legible — building the extension alone
  right after a layout change — now pointing at the ordinary repair (`pnpm --filter
  penguin-browser build`) before the state-file escape. It also no longer misreports a fresh copy
  as stale for ESM-style `.js` specifiers of `.ts` sources (a blind spot the drill exposed).

## The cycle that would have defeated the ordering

The fix relies on pnpm building browser-cli before browser-extension, and it measurably did not:
the packages were a workspace cycle — browser-extension depends on penguin-browser, and
browser-cli carried a devDependency on the extension for **one type-only import**
(`ExtensionState` in `src/shared/test-declarations.ts`) — so pnpm warned and built the pair in
parallel. The state contract moved to `browser-cli/src/shared/extension-state.ts` (it is the
contract between the extension's worker and browser-cli's relay tests; the extension re-exports
it from `penguin-browser/src/…`, the direction of its existing production edge), the
devDependency is removed, the cycle warning is gone, and the builds are ordered.

## Consumers rewired

- `getBundledExtensionPath()` prefers the workspace sibling `browser-extension/dist-packaged`
  and falls back to `dist/extension` — so a stale pre-change `dist/extension` can never shadow a
  fresh build in a source checkout.
- Deployed apps have no workspace sibling: `stage.mjs` assembles `dist-packaged` into the
  deployed package's `dist/extension` (the same pattern as web-dist into the server) and refuses
  to stage without it. The user-loaded copy under `resources/penguin-browser-extension` is
  unchanged.
- `packages/desktop/stage/` joins `.prettierignore`: it is a git-ignored build artifact that
  `format:check` flagged after any local staging run.
- browser-extension's `tsconfig.test.json` now includes `scripts/`, so the new build script is
  type-checked (the issue-0004 lesson applied).

## Verified

- **Strict layout-change drill** on the measured failure mode: a new file under
  `browser-cli/src/relay/`, deep-imported by the extension, with the injected copy confirmed
  stale — one `pnpm -r build`, exit 0, both bundle variants contain the new file's content.
  Before the change this state deadlocked unconditionally.
- Cycle: `pnpm install` no longer prints the cyclic-workspace warning; build logs show
  browser-cli completing before browser-extension starts.
- Staging: `stage.mjs` exit 0; the staged tree carries
  `node_modules/penguin-browser/dist/extension/manifest.json`,
  `resources/penguin-browser-extension/manifest.json`, and the CLI entry. Variant semantics
  pinned by inspection: the staged packaged bundle contains no `welcome.html` reference (the
  flag folds the block away), the resources copy contains it.
- Source-mode resolution: `getBundledExtensionPath()` returns the sibling `dist-packaged`.
- Gates: `pnpm typecheck` green across all seven packages, browser-extension tests 9/9,
  `extension-connection.test.ts` (real Chrome, real per-port extension test builds through the
  new script path) 14/14, `format:check` clean.
