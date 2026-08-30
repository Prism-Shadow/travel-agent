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
└── features/       # chat / trips / models / private-profile / capabilities / skills / admin
```

Server DTO types are imported type-only from `@prismshadow/penguin-server/api`; no server code enters the bundle. `@prismshadow/penguin-core` is a runtime dependency — around twenty files import from it, including value guards used by the stream controller. Rendering rules for streaming partials (start/delta/stop aggregation, complete-message replacement, origin-chain nesting into subagent cards) live in `lib/omni/stream-model.ts`, which is fully unit-tested.

## Development

Prereqs: Node >= 24, pnpm; run `pnpm install` at the repo root first (core must be built — the root `dev:*` scripts handle that).

```bash
pnpm dev:server   # backend at 127.0.0.1:7368 (dev port, not the installed server's 7364)
pnpm dev:web      # Vite dev server at 127.0.0.1:7365; /api proxied (SSE passes through)
```

The proxy target defaults to `http://127.0.0.1:7368` — the development backend, kept off the installed server's 7364 so the two can run at once (`PORT` moves both, `PENGUIN_API_PROXY` overrides the target outright). Auth is a same-origin HttpOnly cookie, so the proxy keeps everything same-origin.

```bash
pnpm --filter @prismshadow/penguin-web typecheck
pnpm --filter @prismshadow/penguin-web test        # vitest (pure logic)
pnpm --filter @prismshadow/penguin-web test:e2e    # Playwright against a mock LLM
pnpm --filter @prismshadow/penguin-web build       # vite build → dist/
```

## Production

No separate static server needed: `@prismshadow/penguin-server` auto-hosts `packages/web/dist` (or `PENGUIN_WEB_DIST`) with an SPA fallback — build the web app, start the server, done. The desktop packaging bundles the built front end; nothing here publishes to a registry.

Part of [travel-agent](../../README.md) · Apache-2.0
