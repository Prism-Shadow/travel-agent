---
id: surface-product-website
type: module-design
status: active
title: Travel Agent product website
parent: goal-travel-agent
depends-on:
  - module-web
  - module-browser-extension
---

# Product website

`website/` owns the standalone product presentation and download guide. It has its own pnpm
workspace and dependency lockfile, independent of the desktop application. Current development
and review are local-only; deployment requires a new explicit user request.
The product-website CI job validates its independent workspace and local HTTP surface without
publishing a hosted version.

## Responsibilities

- Serve a Chinese homepage at `/` and an English homepage at `/en`, with matching metadata,
  language navigation and product content. Requests resolve the saved language choice first,
  or negotiate the browser's preferred Chinese/English language in system mode. Unsupported
  languages fall back to English. Locale redirects preserve the query string and are not cached.
- Navigation stays at the top while the page scrolls. Section links leave room for the header;
  the expanded mobile menu scrolls within the available viewport height.
- Navigation links have rounded hover and keyboard-focus feedback. Compact preference menus offer
  system/Chinese/English language and system/light/dark appearance. Both default to system and
  persist in separate, host-only preference cookies for one year. The theme is applied in server
  HTML before paint, and system mode responds to the browser's color-scheme changes. Browser
  language changes update the locale while language preference remains system. The website's
  preferences are independent of desktop app settings. The compact download link uses the product's line icon.
  All control transitions respect reduced-motion preferences.
- Present the canonical Route Penguin brand, real product screenshots and the two documented
  travel-task recordings. The hotel recording's historical context remains visible.
- The hero pairs the penguin with the desktop login's dotted world map on the theme's page background.
  Its three routes are decorative, with one slow moving light. Reduced-motion and narrow-screen
  views are static; the illustration has no controls, labels or booking-state meaning.
- Explain trips, explicit browser choice, the extension's desktop dependency, model-key setup,
  local storage and the user-completed payment step without claiming full runtime isolation.
- Link download variants to the repository's latest release assets. The user chooses the platform
  and architecture explicitly. The API-key prerequisite and unsigned-installer status are visible.
- Present recordings in two alternating rows: route video on the left with its description on
  the right, then hotel description on the left with its video on the right. Narrow layouts
  stack each video above its description.
- Play recordings in place only after a user action, with native controls, captions, textual
  walkthroughs and an external-video recovery link. Starting one recording pauses the other
  without resetting its position; video playback does not open a modal or lock page scrolling.
  Browser-mode tabs describe the product; they do not
  connect or change any real browser backend.

## Boundaries

This website does not execute agent tasks, access trip data, collect API keys, create user
accounts, or process reservations. It has no database, analytics collector or model dependency.
It imports no engine or application runtime code. The existing Sites-hosted copy is owner-only
and pending removal; local preview does not require a hosted deployment.

Brand files and published presentation assets are copied into `public/media` so the website
build is self-contained. Their provenance is recorded in `README.md`. Product facts are grounded
in the root spec and linked package contracts, not in the generated visual proposal.
