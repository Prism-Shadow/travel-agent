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
- **Chrome pairing.** The application owns a private relay and publishes an installation-scoped
  endpoint after readiness. A restricted Native Messaging entry answers only application discovery
  and pairing requests from Travel Browser; it does not load the UI, acquire its single-instance
  lock, execute commands, or relax Electron security fuses. Startup repairs per-user registration.
  The helper serves ordered requests until Chrome closes its native channel. On macOS its entry
  synchronously prohibits Dock activation and windows before loading discovery code; the normal
  Desktop entry retains its standard activation behavior.
  Shutdown removes only this launch's discovery record. Explicit host removal checks registration
  ownership. Relay failure updates extension availability without changing the persisted backend
  or replaying a task; restarting the application creates a new endpoint for the same pairing.
  A successful user-requested connection check notifies the renderer for localized confirmation;
  a check overtaken by a window close, scope change, or backend change produces no prompt.
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

- **Which conversation the pane is showing, against announces that arrive out of order.** The
  renderer numbers each conversation switch and sends that stamp with the announce; main refuses one
  older than the stamp it last applied, and logs the refusal. A stamp from a different epoch is a
  new renderer document and is adopted rather than compared — a per-mount counter that restarted
  would otherwise make main refuse every later announce, which is worse than the staleness it
  guards. Ordering knowledge and the state it protects now live on the same side of the process
  boundary; before, the renderer numbered its switches and main took whatever arrived last
  ([issue 0008](../../docs/issues/0008-active-session-lags-one-conversation.md)).
- **The backend choice**, whose contract is [[goal-travel-agent]] requirement 5. This package is
  where it is honoured: the relay serves the conversation's selected backend or reports it
  unavailable, and never substitutes the other one. Explicit draft choices are persisted under
  their opaque draft scope, restored at startup and written under the real Session id before its
  first task can start. A failed preference write leaves the previous choice intact. Promotion
  and its exact rollback retain the selected backend without opening an unrelated scope.
- **Redaction before output, which is a guardrail and not a boundary.** Immediately before ARIA,
  page Markdown, clean HTML or a labelled screenshot is produced, the executor pulls that target's
  fingerprint registry over the authenticated relay channel; text is replaced before it enters diff
  caches, and a screenshot whose boxes cannot be verified is refused rather than painted. Deliberate
  raw CDP access still bypasses this, which is exactly why D3 stays closed.
