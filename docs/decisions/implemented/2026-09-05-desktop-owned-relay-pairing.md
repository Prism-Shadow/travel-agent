# Agent Note: Pair Chrome with an application, not a conventional port

Status: implemented — Desktop owns a private relay and Chrome discovers its paired installation.

## Problem

A detached CLI relay can occupy the conventional port before Desktop starts. Desktop cannot
reuse a process that lacks its per-launch IAB key. Moving only Desktop leaves Chrome attached to
the other relay, so both components can look healthy while no conversation can reach Chrome.

## Decision

Desktop binds its own relay directly to an OS-assigned port. A restricted Native Messaging host
discovers live, authenticated application records and lets the extension pair with an installation.
The extension resolves that installation again after restart. CLI discovery, status, ensure and
execution share one invocation-scoped endpoint. A managed call cannot spawn or replace a relay.
Standalone replacement is explicit and cannot terminate a Desktop relay.

The protocol and ownership rules live in the [browser architecture](../../architecture/iab-in-app-browser.md#application-discovery-and-pairing).

## Alternatives considered

- **Pick another fixed port:** another process can occupy it; it leaves discovery unresolved.
- **Kill the current port owner:** it can interrupt another task and transfers no authenticated
  application identity to Chrome.
- **Share any existing relay:** the per-launch IAB key and child lifetime belong to one Desktop.
- **Scan a range of ports in the extension:** it cannot reliably distinguish applications and
  exposes discovery to unrelated local services.
- **Add native-host commands for browser execution:** unnecessary; the existing relay and executor
  already own that work and the unconditional payment stop.

## Consequences

Chrome requires the Native Messaging permission and one user-level host registration. Both the app
and extension need updating together. The helper uses normal Electron startup through a restricted
entry, with macOS activation prohibited before asynchronous discovery imports; no security fuse is
relaxed. The extension keeps one ordered native channel across discovery retries. An absent Desktop
does not launch more helpers; broken native transports use bounded retry backoff. Registration
repairs moved paths on startup, while explicit
removal preserves a registration replaced by another installation.

Application restart reconnects the same pairing and retains explicitly authorized tabs. It does
not replay interrupted commands. A missing paired application stays unavailable. Multiple live
applications and standalone CLI use require an explicit choice in extension settings.

Discovery protects against stale records, reused ports and accidental cross-application pairing.
It does not establish a security boundary against arbitrary code running as the same OS user;
[runtime isolation D3](../proposed/2026-08-16-agent-runtime-isolation.md) remains unresolved.
