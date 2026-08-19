# Codex-style website tabs with real page favicons

The in-app browser tab strip now renders compact rounded tabs in the Codex idiom instead of
the former underline treatment: the page's real favicon (a quiet spinner while loading, a
globe fallback when a site has none or the image fails), a left-aligned truncated title,
hover-revealed close and retain actions, and a new-tab control that follows the last tab.
Overflow stays horizontally scrollable; keyboard navigation and retain/close semantics are
unchanged.

Favicons cross a validated Electron bridge. The main process publishes the icon Chromium
reports, clears it when a new main-frame navigation starts, and `selectFaviconUrl` refuses
anything that is not `http(s)` or `data:image/*`, exceeds 256 KB, or fails to parse — a
page-controlled icon URL is optional chrome, never an IPC payload to trust.

Verification: 132 desktop main-process tests (including favicon selection and clearing) and
the new renderer tab-strip tests pass; desktop and web typechecks pass.
