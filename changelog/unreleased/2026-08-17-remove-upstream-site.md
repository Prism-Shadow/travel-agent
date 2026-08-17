# The PenguinHarness site packages are removed

`packages/landing` and `packages/docs` built and served **penguin.ooo**, PenguinHarness's public
site. This fork does not operate that domain, does not publish that site, and has nothing in common
with its contents.

This is not a new decision. `design/001-architecture.md` §仓库策略 already scheduled it on 2026-08-13
and named the two things blocking it. Both turned out to be gone:

- **`scripts/test-installer.sh`** exercised `packages/landing/public/install.sh`. That file is a
  4.7 KB *thin forwarder* whose only purpose is to be the stable URL served from `penguin.ooo`,
  because GitHub Pages cannot issue redirects. The repo's own 20 KB `install.sh` at the root is a
  different program and is untouched.
- **`packages/desktop/scripts/render-icon.mjs`** never read anything from landing — its SVG comes
  from `packages/web/public/penguin-logo.svg`. It only borrowed landing's `package.json` as a module
  resolution context for `@playwright/test`. Landing was excluded from the workspace, so its
  `node_modules` was never installed and **the script could not have run at all**; it is invoked by
  no build, and its output (`build/icon.png`, `build/icons/*.png`) is committed.

## Removed

| Path | Why |
| --- | --- |
| `packages/landing` | 136 files, 2.7 MB. A complete React/Vite/Tailwind marketing site: ten hard-coded sections (self-improvement, benchmarks, comparisons), 16 blog posts in two languages, 48 product screenshots. Every part of it is about PenguinHarness. |
| `packages/docs` | 74 files, 704 KB. Upstream's documentation site; referenced by nothing at all. |
| `.github/workflows/pages.yml` | Deployed penguin.ooo. Already reduced to `workflow_dispatch`; its stated reason for surviving — that deleting it would turn upstream's frequent edits into delete/modify conflicts — expired with the hard fork, which stopped merging upstream entirely. |
| `scripts/build-site.mjs` | Assembled the two sites into one Pages artifact. Served only the workflow above. |
| `packages/desktop/scripts/render-icon.mjs` | See above: already broken, uninvoked, output committed. |
| The forwarder cases in `scripts/test-installer.sh` | Tested the penguin.ooo bootstrap path. |
| The landing entry in `ci.yml`'s PowerShell parse list | Same. |

`pnpm-workspace.yaml` no longer needs its two exclusion entries.

## Kept

The root `install.sh` / `install.ps1` and `.github/workflows/release.yml`. Those build and publish
this repo's own CLI on a `v*` tag; they have nothing to do with the site, and the installer test
still covers them — the offline, rollback and online cases are unchanged.

## On not keeping a skeleton

The tempting middle path — delete the content, keep the site scaffolding — does not survive contact
with the code. `app.tsx` → `router.tsx` → `pages/home.tsx` renders ten section components whose copy,
imagery and data are all PenguinHarness's; emptying them leaves the React/Vite/Tailwind/router wiring
that `pnpm create vite` produces in twenty minutes, and produces it around whatever information
architecture this product actually needs rather than around one designed for a different product.

Three files were genuinely reusable — `lib/frontmatter.ts`, `lib/blog.ts`, `lib/toc.ts`, under 200
lines together, a small markdown blog system. Deleting is not destroying: `git show` retrieves them
if a site is ever wanted.
