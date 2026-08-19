# Agent Note: Centralize CDP relay state in one store

Status: implemented

Proposed 2026-08-12 in the vendored penguin-browser stack (as `plan-centralize-relay-state.md`),
applying the centralized-state pattern: one immutable state atom, functional `setState()`
transitions, pure functions testable without I/O. Paths below are relative to
`packages/browser-cli/`.

## Problem

The relay server closure accumulated four independent mutable Maps (`extensionConnections`,
`extensionKeyIndex`, `playwrightClients`, `recordingRelays`), each extension connection carrying
further nested mutable state. Mutations were scattered across ~50 sites inside WebSocket handlers,
mixed with I/O, and no state transition had a unit test — the only coverage was an integration
test that launches a real browser.

## Decision

Relay state lives in one Zustand vanilla store created by `createRelayStore()`
(`src/relay/relay-state.ts`) and instantiated once in the server closure
(`src/relay/cdp-relay.ts`).

- `RelayState` holds `extensions` and `playwrightClients`. Every change goes through an exported
  pure transition function called via `store.setState(...)`; transitions do no I/O, and handlers
  keep the sends that need event data (`sendToPlaywright`, `sendToExtension`, emitter events)
  explicit, after the transition.
- `extensionKeyIndex` no longer exists: `findExtensionByStableKey()` derives the lookup from
  `extensions`, returning the newest match. Derive instead of cache.
- Pending request bookkeeping lives in the store too (`addExtensionPendingRequest` /
  `removeExtensionPendingRequest`), one deviation from the original plan, which had kept it as a
  mutable Map on the connection object — moving it in keeps every transition in one vocabulary.
- `recordingRelays` and `streamRelays` stay outside the store as standalone Maps: they hold I/O
  resources (sockets, buffers), not serializable state.

## Alternatives considered

- **Status quo — scattered Maps.** No unit-testable transitions; every handler mixed state
  mutation with I/O.
- **Keep `extensionKeyIndex` as a cached reverse index.** A cache can drift from `extensions`;
  with fewer than ~10 extensions a linear scan costs nothing.
- **Put `recordingRelays` and other I/O holders into the store.** They are resource managers, not
  state; immutably copying socket handles buys nothing.
- **Immer for structural sharing.** Deferred: per-`setState` Map copies are negligible at relay
  scale (dozens of tabs).

## Consequences

- State transitions are data-in/data-out and pinned by unit tests (`test/relay-state.test.ts`);
  the integration suite (`test/relay-core.test.ts`) pins wire behavior.
- The original plan's single `store.subscribe()` for reactive cleanup did not ship: disconnect
  cleanup remains explicit in the close handlers. Revisit only if cleanup drift between handlers
  becomes a real bug source.
- Each `setState` allocates fresh Maps; acceptable at relay scale, with Immer as the recorded
  escape hatch.
