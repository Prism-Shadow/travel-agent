# Canonical Tailwind classes in web; format backlog cleared

All 89 `suggestCanonicalClasses` warnings from the Tailwind v4 language server are resolved by
rewriting class tokens to their canonical v4 forms — CSS output unchanged — and the five files
that predated this change and failed `format:check` are formatted.

## Tailwind canonicalization

- Evidence-driven: a headless LSP probe of the same `tailwindcss-language-server` 0.16.0 that Zed
  runs collected every diagnostic over all 186 `packages/web/src` files — 89 warnings in 31 files,
  62 unique rewrites — and the fix applied exactly the server's suggested forms (longest token
  first, delimiter-guarded). A re-probe after the rewrite reports zero.
- The categories, all behavior-identical under this project's design system:
  - important prefix to v4 suffix: `!text-sm` → `text-sm!`, `dark:!bg-gray-800` → `dark:bg-gray-800!`
  - arbitrary values with theme equivalents: `min-w-[720px]` → `min-w-180`, `h-[18px]` → `h-4.5`
  - CSS-variable shorthand: `bg-[var(--accent-bg)]` → `bg-(--accent-bg)`
  - arbitrary properties to utilities: `[fill:var(--tile-fg)]` → `fill-(--tile-fg)`
  - v4 renames: `bg-gradient-to-t` → `bg-linear-to-t`, `break-words` → `wrap-break-word`
  - bare values: `z-[60]` → `z-60`, `shrink-[9999]` → `shrink-9999`
- 819 web unit tests pass; no test or E2E spec referenced the old literals; web typecheck green.

## Formatting

- Two rewritten files re-wrapped under Prettier's print width (shorter tokens made joined lines
  fit): `sidebar.tsx`, `message-files-card.tsx`.
- Five files failing `format:check` before this change are formatted: desktop `browser-pane.ts`,
  `preload-browser.ts`, `tab-lifecycle.test.ts`; web `use-browser-pane.ts`,
  `browser-pane-address.test.ts`. Pure whitespace/wrapping — no code change.
