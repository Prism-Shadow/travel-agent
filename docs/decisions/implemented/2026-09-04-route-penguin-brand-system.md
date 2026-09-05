# Agent Note: Use Route Penguin across product and browser surfaces

Status: implemented — one canonical vector owns every Travel Agent and Travel Browser mark

## Problem

Travel Agent inherited the flying PenguinHarness artwork even though the consumer product is
organized around trips and journeys. The selected replacement existed only as a small raster, while
Web, Desktop, the Chrome extension, its state-dependent toolbar icons, and the built-in browser
Skill each carried independent assets. Replacing those files by hand would create several sources
of truth and make the next change impossible to verify.

## Decision

`assets/brand/travel-agent-logo.svg` is the canonical production mark. Its upright penguin retains
PenguinHarness family recognition; the cobalt route and destination point distinguish the travel
product; the single highlighted eye is the explicit parent-brand cue.

The repository-level brand generator produces the Web SVG, Desktop raster sources, and every
Travel Browser extension raster or SVG variant from that geometry. The root build checks generated
files before compiling. The browser naming choice is superseded by
[Travel Browser display naming](2026-09-05-travel-browser-display-name.md); its connected, idle,
and unavailable state semantics remain: full color denotes the connected/default treatment, black denotes idle, and gray
denotes unavailable or transitional states. The built-in browser Skill uses a line-art adaptation
of the same mark to satisfy the Skill icon contract.

## Alternatives considered

- **Keep Penguin Browser visually separate.** This preserved the previously planned endorsed-sibling
  architecture, but it conflicted with the chosen unified company/product identity and left the
  browser surfaces looking like a different product.
- **Ship the approved PNG everywhere.** This preserved its pixels but failed at desktop sizes,
  embedded JPEG blur in every surface, and provided no editable source.
- **Wrap the raster in an SVG container.** This changed the file extension without producing vector
  geometry or solving small-size rendering.
- **Maintain platform files by hand.** This avoided a generator dependency but offered no freshness
  guarantee across twenty-four committed outputs.

## Consequences

- One SVG edit updates the Web, desktop installers, extension toolbar, extension states, and runtime
window icon through `pnpm brand:generate`.
- The root owns `sharp` as an explicit development dependency; no script reaches into another
  package's private dependency tree.
- The eye is clear at larger sizes and becomes an optical facial cue at extension sizes. The route,
  silhouette, and destination point carry recognition when the eye no longer resolves.
- The original raster remains a design reference rather than a shipped source.
- This decision establishes technical consistency, not trademark clearance.

The default account avatar is a separate local portrait illustration at
[`packages/web/public/user-avatar.png`](../../../packages/web/public/user-avatar.png), generated
with the canonical mark as its visual reference. It repeats the navy body, white face, cobalt
beak, highlighted eye and route motif as a scarf, on an ice-blue field. It is an account portrait,
not a second product mark, and the brand generator does not overwrite it. Expanded, collapsed
and mobile account controls use the same circular crop.

The welcome screen uses a static vector illustration at
`packages/web/src/components/ui/welcome-penguin.tsx`. The brand generator produces its transparent
penguin by omitting only the canonical SVG's square field; body, eye highlight and route geometry
remain identical. The component supplies a solid ice-blue field and sparse decorative accents.
It does not replace the account portrait or generated platform icons.
