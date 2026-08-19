# Fix: the desktop app could not launch after the browser-cli regrouping

`pnpm desktop` died at load with

```
Cannot find module '.../penguin-browser/dist/relay-discovery.js' imported from .../desktop/dist/main.js
```

`packages/desktop` reaches past `penguin-browser`'s public entry into a specific build output —
`main.ts` and `browser-relay.ts` both import `dist/relay-discovery.js` — and the same-day regrouping
of that package moved it to `dist/relay/relay-discovery.js`.

The move updated the extension's deep imports and the build scripts. It missed this one, and none of
the gates caught it: `pnpm typecheck` passes because the desktop project resolves against the `.d.ts`
that the failing import's *old* path no longer has, `pnpm build` passes because nothing imports it at
build time, and the browser-cli suite passes because the caller is in another package. The failure
surfaces only when Electron actually loads `main.js`.

`packages/browser-cli/src/README.md` now names both deep-importing packages rather than only the
extension, and says why the desktop one is the easier to miss: it resolves at runtime, so grep for
`penguin-browser/dist/` and `penguin-browser/src/` after any move in that package.
