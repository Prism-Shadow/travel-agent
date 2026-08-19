# Browser CLI package cleanup: docs relocated, vendor records trimmed

`packages/browser-cli` now contains only what the package builds and runs. Three kinds of
files left it:

- **Upstream marketing leftovers deleted.** `screenshot-440x280.png` and `screenshot@2x.png`
  were Chrome Web Store / website promo images from the upstream penguin-browser repo, referenced
  by nothing in this tree.
- **Reference docs moved to `docs/browser/`.** The frozen upstream `CHANGELOG.md` (history
  before the 2026-08-12 import; provenance is now inlined in its header) and
  `plan-centralize-relay-state.md` (the relay-state refactor design, formerly
  `packages/browser-cli/docs/`) live with the rest of the contributor docs. The
  `src/relay-state.ts` header comment points at the new path.
- **`VENDOR.md` removed.** Its pointer references (tsconfig, three build scripts,
  docs/design/001) were rewritten to stand alone; the full import/verification record remains in
  git history.

Also closed a `.gitignore` gap: `packages/browser-cli/test-results/` (relay logs written by
`src/test-utils.ts` on every test run) was never ignored, unlike its `packages/web`
counterpart.
