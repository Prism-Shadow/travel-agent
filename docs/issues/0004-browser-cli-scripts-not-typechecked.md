# browser-cli's dev scripts are excluded from type checking, and several do not compile

- **Status:** open, avoided rather than fixed
- **Area:** `packages/browser-cli/scripts/`, `packages/browser-cli/tsconfig.test.json`
- **Found:** 2026-08-19, when `tsconfig.test.json` was added and briefly included `scripts/`

## Summary

`tsconfig.json` covers `src` only. When `tsconfig.test.json` was added (so that `test/` would be
type-checked after moving out of `src/`), it initially included `scripts/` as well, and five errors
appeared immediately:

```
scripts/extension-connect.ts(1,24):        Cannot find module 'playwright-core'
scripts/extension-current-pages.ts(1,24):  Cannot find module 'playwright-core'
scripts/extension-new-page.ts(1,24):       Cannot find module 'playwright-core'
scripts/long-running-stability-test.ts:    Cannot find module 'bun'  /  Cannot find name 'Bun'
```

The three `playwright-core` imports name a package this workspace does not have — the dependency is
`@xmorse/playwright-core`. `long-running-stability-test.ts` is written for the Bun runtime, which
this package stopped requiring when the build moved to esbuild.

`scripts/` was dropped from `tsconfig.test.json` to keep that unrelated breakage from burying the
real errors the new config was there to find. That was the right call for the change in hand and the
wrong end state: the build scripts (`build-client-bundles.ts`, `build-resources.ts`,
`build-extension-bundle.ts`) *are* load-bearing and are equally unchecked.

## Evidence that unchecked build scripts break silently

The same refactor broke three path constants inside those scripts (client-bundle entries, example
sources, three generated `.d.ts` paths). None was a type error — they are strings — but the point
stands that nothing in CI reads these files until a build runs.

## Suggested resolution

1. Fix the three `playwright-core` specifiers to `@xmorse/playwright-core`.
2. Decide on `long-running-stability-test.ts`: port off Bun, or delete it — the package has no other
   Bun dependency since the build moved to esbuild.
3. Add `scripts` back to `tsconfig.test.json`'s `include`.
