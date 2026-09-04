# Brand assets

`travel-agent-logo.svg` is the canonical source for the Route Penguin mark used by Travel Agent
and Penguin Browser surfaces in this repository. It is a vector redraw of the user-approved upright
penguin, blue journey path, separate destination point, and PenguinHarness-style eye.

The SVG uses four flat colors:

- field: `#F8FAFC`
- penguin: `#0D1B3D`
- route and beak: `#0B5CFF`
- eye: `#0D1827`

The rounded field keeps the white belly legible on dark surfaces; the canvas outside that field is
transparent. The mark contains no embedded raster, script, font, gradient, or external reference.

## Generated outputs

Run `pnpm brand:generate` after editing the canonical SVG. The generator owns:

- the Web favicon, login mark, profile mark, and notification SVG;
- the 1024 px Desktop source plus the 128/256/512 Linux icon set;
- Penguin Browser's default 16/32/48/128 px extension icons;
- Penguin Browser's connected, idle, disabled, and injected-toolbar variants.

Penguin Browser keeps its product name and functional state colors; it shares the Route Penguin
geometry. Its 24 px built-in Skill icon is a manually maintained `currentColor` line adaptation
because that icon system has a different rendering contract.

`pnpm brand:check` regenerates every derived asset in memory and fails when a committed output is
missing or stale. The root build runs that check before compiling packages.

The SVG is the editable production source. The original low-resolution raster remains design
provenance only and is not embedded in shipped assets. Trademark and near-neighbor screening has
not been performed; no basis found for claiming that this mark is legally clear.
