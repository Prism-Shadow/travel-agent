# @prismshadow/penguin-web

travel-agent's consumer surface — a React 19 + Vite + Tailwind CSS 4 SPA that renders the OmniMessage stream and puts the traveller's Trip on screen. There is no second front end: the browser serves this app during `pnpm dev`, and the Electron renderer shows the same SPA in the shipped desktop app. What it owns and its boundary: [`SPEC.md`](SPEC.md).

## Layout

```
src/
├── main.tsx / app.tsx / router.tsx / styles.css
├── api/            # fetch wrapper, typed endpoint functions, EventSource (SSE) wrapper
├── state/          # auth / project / sessions / trips / theme / locale contexts
├── lib/
│   ├── omni/       # OmniMessage stream → view-model reducer + connect-first/dedup controller
│   └── …           # formatting, i18n dictionaries (zh/en), attachments, helpers
├── components/     # ui primitives (modal, drawer, select, …) + app layout
└── features/       # chat / trips / saved / models / private-profile / capabilities / admin
```

Server DTO types are imported type-only from `@prismshadow/penguin-server/api`; no server code enters the bundle. `@prismshadow/penguin-core` is a runtime dependency — around twenty files import from it, including value guards used by the stream controller. Rendering rules for streaming partials (start/delta/stop aggregation, complete-message replacement, origin-chain nesting into subagent cards) live in `lib/omni/stream-model.ts`, which is fully unit-tested.

### UI component integration

The package already has TypeScript, Tailwind CSS 4 and the shadcn-style `src/components/ui/`
directory. In this monorepo, `/components/ui` means `packages/web/src/components/ui`, not a new
repository-root folder. Keeping reusable primitives here gives pages one consistent import location.
Global styles are `src/styles.css`; login-specific styles are `src/pages/login.css`.

This is a Vite SPA with existing primitives, not a Next.js or shadcn CLI scaffold. Imported
components use normal images and the existing `state/theme` provider. They require no second theme
provider. If shadcn CLI management is desired later, follow the
[Vite installation guide](https://ui.shadcn.com/docs/installation/vite): configure `@/*` to `./src/*`
in this package's TypeScript paths and `@` to `./src` in Vite, then run
`pnpm dlx shadcn@latest init` from `packages/web`. Point its components at `src/components`, UI at
`src/components/ui`, and CSS at `src/styles.css`; review generated changes to existing primitives
and tokens before using `add`. No framework or styling setup is required to use this map.

`src/components/ui/map.tsx` exports `WorldMap`. `src/pages/login-map.tsx` is the product-specific
usage example: illustrative city pairs, with no external images or account data. Props include
`dots`, `lineColor`, `showLabels`, `labelClassName`, `animationDuration`, `loop`, `paused` and
`className`. Route drawing and the travelling dot are SMIL animations on the SVG's own timeline
(no animation library); `dotted-map` is a development-only generator dependency, so country
geometry and map computation do not enter the login bundle. Both the basemap and
overlay use shared equirectangular bounds rather than mixing geographic projections.

Regenerate the committed `public/maps/world-dots.svg` after changing those bounds:

```bash
pnpm --filter @prismshadow/penguin-web map:generate
```

The basemap is generated with [dotted-map](https://github.com/NTag/dotted-map) (MIT), whose
country geometry comes from [world.geo.json](https://github.com/johan/world.geo.json).

## Development

Prereqs: Node >= 24, pnpm; run `pnpm install` at the repo root first (core must be built — the root `dev:*` scripts handle that).

```bash
pnpm dev:server   # backend at 127.0.0.1:7368 (dev port, not the installed server's 7364)
pnpm dev:web      # Vite dev server at 127.0.0.1:7365; /api proxied (SSE passes through)
```

The proxy target defaults to `http://127.0.0.1:7368` — the development backend, kept off the installed server's 7364 so the two can run at once (`PORT` moves both, `PENGUIN_API_PROXY` overrides the target outright). Auth is a same-origin HttpOnly cookie, so the proxy keeps everything same-origin.

The login page always shows the product's fixed initial credentials, imported from the server's
`INITIAL_ADMIN_CREDENTIALS` (`traveler` / `traveler-2026`). A fresh data root signs in with them;
an installation whose password was changed simply ignores the panel. There is no build-time
configuration for this display.

```bash
pnpm --filter @prismshadow/penguin-web typecheck
pnpm --filter @prismshadow/penguin-web test        # vitest (pure logic)
pnpm --filter @prismshadow/penguin-web test:e2e    # Playwright against a mock LLM
pnpm --filter @prismshadow/penguin-web build       # vite build → dist/
```

## Production

No separate static server needed: `@prismshadow/penguin-server` auto-hosts `packages/web/dist` (or `PENGUIN_WEB_DIST`) with an SPA fallback — build the web app, start the server, done. The desktop packaging bundles the built front end; nothing here publishes to a registry.

Part of [travel-agent](../../README.md) · Apache-2.0
