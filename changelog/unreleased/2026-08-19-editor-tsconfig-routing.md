# Editor tsconfig routing: phantom diagnostics rooted out

Files not covered by their package's `tsconfig.json` were typechecked by editors against the
repo-root harness baseline, producing ~150 phantom errors that no CI gate reproduces; the root
`tsconfig.json` is now a solution-style router, and the two packages whose tests no gate checked
gained real test configs.

## The mechanism

- tsserver (Zed/vtsls, VS Code alike) auto-discovers only files literally named `tsconfig.json`,
  walking up from the open file until one **includes** it. `tsconfig.test.json` is invisible to it.
- `packages/browser-cli/tsconfig.json` includes only `src`, so its tests fell through to the repo
  root config, which swept `packages/*/src` and `packages/*/test` under the harness baseline —
  Bundler resolution, no DOM lib, no chrome types, `noUncheckedIndexedAccess`. Running that program
  yields 4388 errors; the editor showed the slice for open files (e.g. 13 in
  `mv3-lifecycle.test.ts`: `'serviceWorker' is possibly 'undefined'`, `Property 'tabs' does not
  exist on type 'typeof chrome'` — the latter because `browser-extension`'s partial
  `declare namespace chrome` was the only `chrome` in that program).

## The fix

- Root `tsconfig.json` is now `files: []` plus references to every per-package config, including
  the three `tsconfig.test.json`s, so tsserver routes each file to the config that owns it. It is
  deliberately not a build entry point; nothing runs tsc against it.
- `packages/transaction` and `packages/browser-extension` gained `tsconfig.test.json` (src + test,
  no emit) wired into their `typecheck` scripts — their `test/` directories were previously
  typechecked by nothing. The extension's test config needs `moduleResolution: bundler` (vitest's
  types re-export vite 7's node API) and `skipLibCheck` (two vite majors clash inside
  `node_modules` d.ts).
- Closing that hole surfaced one real error: `booking.test.ts`'s `submit` mock returned a string
  while `reconcile` returned the order object, though both share the outcome type `T`. The mock now
  returns the object shape; runtime behavior is unchanged (153 transaction tests pass).

## Verification

- tsserver protocol probe before/after: `projectInfo` for `mv3-lifecycle.test.ts` moved from the
  root config (13 semantic diagnostics) to `browser-cli/tsconfig.test.json` (0); transaction and
  browser-extension tests route to their new test configs (0); `web/src` files still route to
  `packages/web/tsconfig.json` (0).
- `pnpm -r typecheck` green with the two extended scripts.
- Out of scope: the `suggestCanonicalClasses` warnings in `packages/web` come from the Tailwind CSS
  language server (v0.16.0, default severity warning), not from TypeScript.
