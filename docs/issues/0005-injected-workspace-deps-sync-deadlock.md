# Changing browser-cli's file layout deadlocks the extension build

- **Status:** open — a trap, with a known manual escape
- **Area:** `pnpm-workspace.yaml` (`injectWorkspacePackages`, `syncInjectedDepsAfterScripts`),
  `packages/browser-cli/scripts/build-extension-bundle.ts`
- **Found:** 2026-08-19, during the `src/` layout refactor

## What the workspace does

`injectWorkspacePackages: true` means `packages/browser-extension` does not symlink to
`packages/browser-cli`. It symlinks to a **materialized copy** under
`node_modules/.pnpm/penguin-browser@file+packages+browser-cli…/`.

The copy is made of **hard links**, which decides exactly what propagates. Measured:

| Change in `packages/browser-cli` | Visible to the extension without re-syncing? |
| --- | --- |
| Edit a file's contents | **Yes** — same inode (verified: `116635280` on both paths) |
| Add / rename / move / delete a file | **No** — the directory entry only exists in the original |

That is why ordinary work never needs a sync and a layout change always does.

## The deadlock

`syncInjectedDepsAfterScripts: [build]` is pnpm's answer: after an injected package's `build`
script, the copy is re-synced. Measured, with a probe file added to `src/relay/`:

| Invocation | Probe appears in the injected copy? |
| --- | --- |
| `pnpm --filter penguin-browser build` from the repo root, build succeeds | Yes |
| `pnpm build` from inside `packages/browser-cli`, build succeeds | Yes |
| `pnpm build`, build **fails** (exit 2) | **No** |

Now note what `browser-cli`'s own build does: `scripts/build-extension-bundle.ts` builds the
**extension** as one of its steps. So after a layout change:

1. `pnpm build` in browser-cli — its own `tsc` passes.
2. The nested extension build runs, resolves `penguin-browser/src/…` against the **stale** copy, and
   fails with `Cannot find module 'penguin-browser/src/relay/cdp-types'`.
3. The build exits non-zero, so **the sync never runs**.
4. Every retry fails identically.

The sync is gated on a build succeeding, and that build cannot succeed until the sync has run.

## The escape

`pnpm install` re-materializes the copy. In pnpm 11 that alone is not enough — it compares against
`node_modules/.pnpm-workspace-state-v1.json`, answers `Already up to date` and does nothing, even
with `--force`. What actually worked:

```bash
rm -f node_modules/.pnpm-workspace-state-v1.json && pnpm install
```

## Why not just drop the injection

It was introduced upstream (`de6380f`, 2026-07-30) for offline installer bundles, and every artifact
of that feature — `install.sh`, `install.ps1`, `install.cmd`,
`scripts/package-offline-bundles.sh`, `packages/docs` — has since been deleted from this fork. But
the desktop release now depends on the same mechanism: `packages/desktop/electron-builder.yml`
describes shipping "a portable, self-contained node_modules (workspace packages materialized)", and
`scripts/stage.mjs` copies through those injected copies by name. Removing the flag would break
packaging.

## Suggested resolution

Cheapest first, and none of them is obviously right yet:

1. **Make the failure legible.** `build-extension-bundle.ts` can detect the specific
   `Cannot find module 'penguin-browser/…'` failure and print the escape command, turning a
   30-minute puzzle into a one-line instruction.
2. **Break the nesting.** browser-cli's `build` builds the extension, which is what puts a consumer
   of the stale copy *inside* the producer's build. If CI built the two packages in sequence
   instead, the sync would land between them.
3. Confine injection to the packages that need it (`desktop`) if pnpm's config allows that
   granularity — not verified.
