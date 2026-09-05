---
id: module-browser-cli
type: module-design
status: active
title: browser-cli — penguin-browser, and the place payment stops
parent: arch-travel-agent
tags:
  - browser
  - vendored
  - payment-gate
---

# browser-cli — penguin-browser, and the place payment stops

## Responsibility

penguin-browser: the CLI the agent invokes, the CDP relay both backends converge on, and the
Playwright executor that drives a page. Vendored from upstream `penguin-browser` at `ba9e13b`
(2026-08-12); upstream history stays in the upstream repository and post-import changes are in this
repository's git history.

The agent gains no browser tool. It runs this CLI through `exec_command` like any other command,
taught by the `penguin-browser` skill. That indirection is what lets the engine stay ignorant of the
browser's existence.

## What it owns

- **The payment stop.** The requirement is [[goal-travel-agent]] requirement 1; this package is
  where it is enforced, in `src/executor/payment-gate.ts`. There is no agent-triggered payment
  executor anywhere in the repository. When a new surface can click, it is wired through the gate.
- **The write surface, enumerated rather than sampled.** `src/executor/write-gate.ts` states the
  rule: what may be written to is decided by enumeration, because a sampled check silently permits
  whatever it did not sample.
- **Backend-agnostic execution.** The relay presents one standard CDP endpoint; the in-app
  `WebContentsView` (over `/iab`) and the user's own Chrome (over the extension socket) are two
  transports behind it. The executor does not know which one it is driving — see [[arch-iab]].
- **Handover state** (`src/executor/handover-state.ts`): when the person takes the wheel, and when
  the agent may take it back.

## Relay identity and discovery

Desktop starts a private loopback relay with an OS-assigned port and a per-launch instance id.
The extension transport requires the matching instance id and extension credential in addition
to its allowlisted Chrome origin. That credential is distinct from the IAB key and is never
included in public status output.

Installation records in `~/.penguin-browser/desktop-instances/` are owner-only and atomically
published. Discovery checks file ownership, live owner and a fresh HMAC challenge to the endpoint.
One live Desktop can be discovered automatically; more than one requires explicit selection.
Desktop-scoped CLI calls pin the inherited port and launch identity. Ensure, status, IAB creation,
session operations and execution share the same endpoint for the invocation. An unavailable or
replaced instance fails without starting, stopping or substituting a relay. Standalone startup
honors its configured port and never kills an occupied listener automatically; explicit `serve
--replace` refuses an application-owned relay.

A recorded Desktop conversation on an external dev server also requires authenticated application
discovery. Without a launch identity, an inherited port from an older shell cannot override that
discovery. An explicit remote host cannot redirect such a conversation.

## Boundary

This package has **no workspace dependencies**. Nothing in the engine may depend on it
([[module-server]]), and it must not learn that an agent engine exists on the other side of the CLI
boundary: it receives commands, not intentions. [[module-desktop]] is the only consumer that wires
it to anything.

`packages/browser-extension` depends on this package, not the reverse. That direction was made
one-way deliberately: the pair was once a workspace cycle over a single type-only import, which
made pnpm build them in parallel and defeated the ordering a build fix depended on. The shared
contract now lives in `src/shared/extension-state.ts` and the extension re-exports it along its
production edge.

## Conventions that differ from the rest of the repository

Being vendored, this package keeps its own formatting (`.prettierignore` excludes it) and its own
independently-managed version, which encodes CLI/relay compatibility rather than the product
release. `src/README.md` maps the source layout; this document states the contract.

Its suite launches real Chromium instances and **runs its files in parallel**, which the harness is
built for: the extension build is serialized across worker processes by an atomic `mkdir` lock and
each worker builds into a per-port dist directory (`test/test-utils.ts`). Anything added here that
shares a file between workers has to say how it is serialized — a shared CDP log that every suite
truncated is what once made this suite's failures move between runs.
