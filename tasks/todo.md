# Issue 0005 — dissolve the injected-deps build deadlock

## Evidence gathered first

- The deadlock: extension bundling ran *inside* browser-cli's build; the injected copy re-syncs
  only after that build **succeeds**; the nested step failed against the stale copy after any
  layout change — sync gated on a build that needed the sync.
- `pnpm deploy` (desktop staging) requires global `injectWorkspacePackages` in pnpm ≥ 10 →
  confining injection is not available; the injection stays.
- Artifact consumers mapped: `browser-cli/dist/extension` served only `getBundledExtensionPath()`
  (CLI auto-load); desktop stages `browser-extension/dist` separately; browser-cli tests build
  their own per-port extension outputs.
- Measured during the fix: the pair was a workspace **cycle** (browser-cli devDep on the extension
  for one type-only import) — pnpm built them in parallel, which would have defeated the ordering
  the fix depends on.

## Changes

- [x] browser-cli build drops the nested step; `scripts/build-extension-bundle.ts` deleted.
- [x] browser-extension builds both variants itself; new `scripts/build-packaged.ts` carries the
      preflight (now also mapping `.js` specifiers to `.ts` sources — drill-exposed blind spot)
      and skips under a pinned PENGUIN_BROWSER_EXTENSION_DIST (test builds).
- [x] Cycle broken: `ExtensionState` contract moved to `browser-cli/src/shared/extension-state.ts`;
      extension re-exports it along its production edge; devDep removed; lockfile updated.
- [x] `getBundledExtensionPath()`: sibling `dist-packaged` first, `dist/extension` fallback.
- [x] `stage.mjs` assembles `dist-packaged` → deployed `penguin-browser/dist/extension`.
- [x] `.prettierignore` gains `packages/desktop/stage/`; extension `tsconfig.test.json` gains
      `scripts/`.

## Verified

- [x] Strict drill from a confirmed-stale copy: new deep-imported file → one `pnpm -r build`,
      exit 0, content in both variants (previously an unconditional deadlock).
- [x] Cycle warning gone; builds ordered browser-cli → browser-extension.
- [x] `stage.mjs` exit 0; staged tree has both extension copies + CLI entry; packaged variant
      has no `welcome.html` (folded), resources copy has it.
- [x] Source-mode `getBundledExtensionPath()` → sibling `dist-packaged`.
- [x] `pnpm typecheck` (7/7), extension tests 9/9, `extension-connection.test.ts` 14/14 with real
      Chrome through the new test-build path, `format:check` clean.

## Records

- [x] Changelog entry + README line; issue file removed; AGENTS.md open-issue table emptied;
      browser-cli src/README paragraph and the lessons.md injected-deps lesson updated to the
      new structure (cycle sentence added).
