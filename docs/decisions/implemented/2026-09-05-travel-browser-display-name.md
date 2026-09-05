# Agent Note: Name the Chrome extension Travel Browser

Status: implemented — browser-facing names follow the Travel Agent product identity

## Problem

The Chrome tab group and extension surfaces carry the upstream browser name while the app and
logo identify Travel Agent. People using Chrome need to recognize which product controls a tab
and which extension to pin or reconnect.

## Decision

The Chrome extension's display name is **Travel Browser**. Its owned tab groups, installation
page, in-page toolbar, context menu, Desktop setup prompts and extension-specific troubleshooting
use that name. This supersedes the name-retention part of the
[Route Penguin brand decision](2026-09-04-route-penguin-brand-system.md); the canonical logo and
connected/idle/unavailable icon treatments remain the same.

Only display text changes. Package names, the `penguin-browser` command, compatibility version,
manifest public key, installation identity, protocol fields and persisted ownership keys remain
stable. Group synchronization restyles only the groups recorded as extension-owned, including
an owned group with an earlier display name. A same-title user group is not evidence of ownership.

## Alternatives considered

- **Rename only the tab group.** Chrome's extension list and setup prompts still identify a
  different name, making installation and reconnection confusing.
- **Rename the executable and persisted identifiers too.** A display-name change does not
  justify breaking agent commands, installation bindings or stored tab-group ownership.
- **Find old groups by title and rename them.** User groups may have the same title; only the
  recorded group id establishes ownership.

## Consequences

Existing unpacked installations pick up the name after a build and extension reload. Tabs that
need reconnection receive the current group title when grouped by the extension. No new browser
permissions or authorization paths are introduced.
