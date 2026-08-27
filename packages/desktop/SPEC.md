---
id: module-desktop
type: module-design
status: active
title: desktop — the shell where the engine and penguin-browser are joined
parent: arch-travel-agent
depends-on:
  - module-server
  - module-browser-cli
tags:
  - desktop
  - electron
---

# desktop — the shell where the engine and penguin-browser are joined

## Responsibility

The Electron application: one process tree that owns everything the person sees. It is **the only
package permitted to depend on both the engine and penguin-browser**, and that is its reason to
exist — Hard Rule 5 forbids the engine from knowing the browser exists, so the join has to happen
somewhere, and this is the somewhere.

## What it owns

- **Process supervision.** It forks the server (`server-process.ts`) and starts the relay
  (`browser-relay.ts`, a `utilityProcess`), handing the broker socket and token across by
  environment. A packaged install therefore needs no second terminal.
- **The visible in-app browser.** `WebContentsView` tabs beside the chat, driven over the `/iab`
  channel through `iab-transport.ts`. The architecture and lifecycle rules are [[arch-iab]]; they
  are not restated here.
- **The vault and its broker.** Secrets live in the main process, never in the renderer and never in
  the agent's context. The capability gates `vault.l2l3` and `secret_entry.live` are fail-closed
  pending decision D3
  ([agent-runtime-isolation](../../docs/decisions/proposed/2026-08-16-agent-runtime-isolation.md)).
- **Packaging and platform identity**: installers, the app's name and category, crash reporting,
  update support, and the data-root migration path.

## Boundary

| May depend on | Direction that must never reverse |
| --- | --- |
| `@prismshadow/penguin-core`, `@prismshadow/penguin-server`, `penguin-browser` | Nothing in `core`, `server` or `browser-cli` may depend on this package |

The value of that asymmetry is that the engine stays a hard-forkable snapshot and penguin-browser
stays independently vendored: both can be replaced without touching each other, because neither
knows the other is there.

## What this shell enforces

- **The backend choice**, whose contract is [[goal-travel-agent]] requirement 5. This package is
  where it is honoured: the relay serves the conversation's selected backend or reports it
  unavailable, and never substitutes the other one.
- **Redaction before output, which is a guardrail and not a boundary.** Immediately before ARIA,
  page Markdown, clean HTML or a labelled screenshot is produced, the executor pulls that target's
  fingerprint registry over the authenticated relay channel; text is replaced before it enters diff
  caches, and a screenshot whose boxes cannot be verified is refused rather than painted. Deliberate
  raw CDP access still bypasses this, which is exactly why D3 stays closed.
