---
id: module-browser-extension
type: module-design
status: active
title: browser-extension — Travel Browser pairing and Chrome transport
parent: arch-travel-agent
depends-on:
  - module-browser-cli
tags:
  - browser
  - extension
---

# Travel Browser

## Responsibility

The Chrome extension connects explicitly authorized pages to the relay through `chrome.debugger`.
It depends on browser-cli's shared contracts, never the agent engine. Native Messaging discovers
the desktop application's endpoint; it does not carry browser commands.

## Pairing and authorization

- Production builds initially discover one live Travel Agent installation and remember it. Multiple
  installations require explicit selection. Reconnects resolve that installation again; an absent
  paired application stays disconnected. Standalone CLI mode is an explicit user choice.
- The worker reuses one Native Messaging port for ordered discovery requests, including settings
  refreshes. Desktop absence does not restart the helper. A broken or timed-out native transport
  is discarded; retries back off from three seconds to at most one minute. Late replies cannot
  satisfy a subsequent request. A valid reply resets the transport backoff.
- A desktop connection requires the launch id and an extension-only credential in its WebSocket
  handshake. The credential stays outside URLs, logs, status UI and webpage content.
- Changing application or mode first disconnects the previous application's authorized tabs. It
  cannot occur while a connection or connection attempt is active. Reconnecting to the same
  application preserves authorized tabs without replaying interrupted commands.
- Clicking the extension icon authorizes one existing tab. The conversation's Chrome backend
  selection separately authorizes creation of task tabs. Pairing alone does not authorize unrelated
  open pages or change a conversation's browser backend.

Connection settings show the paired application and live transport status. The welcome page is an
illustrated guide, not a live connection display. Both packaged variants include these pages;
`dist-packaged` suppresses automatic welcome-page opening. Custom-port test builds can default to
standalone mode. Runtime protocol and relay ownership are defined in [[module-browser-cli]] and
[[arch-iab]].
