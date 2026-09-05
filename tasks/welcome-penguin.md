# Welcome penguin illustration

## Scope

Replace the welcome screen's travel collage with a static illustration using the exact Route
Penguin silhouette. Use the original navy, white and cobalt colors, a solid ice-blue circular
field and sparse route accents. Preserve the existing page background and composer layout.

## Implementation

- Generate a transparent SVG from the canonical mark, omitting only its square background.
- Compose the welcome illustration as a small, noninteractive SVG with light/dark field colors.
- Remove the rejected 3D renderer, its tests and its dependencies.
- Verify generated assets, type checking, build output and the real welcome page.

## Validation

- `pnpm brand:generate` emitted only the new transparent penguin SVG; `pnpm brand:check` passed.
- `pnpm typecheck` passed across the workspace.
- `pnpm --filter @prismshadow/penguin-web test` passed: 66 files, 795 tests.
- `pnpm --filter @prismshadow/penguin-web build` passed, with the existing large-chunk warning.
- Targeted Prettier checks and `git diff --check` passed.
- Playwriter reused the existing signed-in welcome tab. Light and dark screenshots confirmed
  the illustration renders without a canvas. At a 390 px viewport, the illustration remains
  visible and the document has no horizontal overflow. Temporary theme and viewport changes
  were restored. Screenshots are local evidence under `artifacts/design-qa/penguin-flat*.png`.
