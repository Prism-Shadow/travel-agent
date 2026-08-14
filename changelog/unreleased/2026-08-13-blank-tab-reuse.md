# tabs.open reuses the leftover about:blank tab

Opening a site (for example Ctrip) after `session new` or after closing the last authorized tab left two tabs in the penguin-browser group: an empty `about:blank` and the real page.

Every CLI execute auto-creates a blank tab when Playwright has no pages (`PENGUIN_BROWSER_AUTO_ENABLE`). The skill then runs `tabs.open(url)`, which always called `newPage()`. The blank was never claimed, so it stayed.

`tabs.open` now serializes tab acquisition within a session, claims an unclaimed blank before navigating it, and never treats a concurrent same-session re-claim as a new acquisition. A blank another session already holds, or a tab that already has a URL, is left alone. If navigation fails, ownership is released; a page created by that call is closed, while a reused blank remains available for retry.
