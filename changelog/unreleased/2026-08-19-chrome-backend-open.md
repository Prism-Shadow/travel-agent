# Chrome is available without replacing the IAB default

The Desktop Browser menu now offers **My own Chrome (extension)** in normal builds. New
conversations still select the visible in-app browser, and the choice remains per conversation and
locked for the duration of a task.

Backend selection is now enforced symmetrically across the Desktop and Browser CLI. The normal
`session new` command resolves the recorded choice automatically; an agent cannot bypass an IAB
selection by omitting `--iab`, and it cannot bypass either selection with direct, headless, or cloud
mode. Standalone and plain-web CLI runs without a Desktop preference retain extension behaviour.

The preference is persisted before the UI commits a change or the first task starts. Write failures
are reported instead of leaving the UI and CLI on different backends, and a previously selected but
temporarily unavailable Chrome backend stays visibly selected until the user explicitly changes it.

Selecting Chrome checks the relay's extension status and opens the bundled extension setup when
needed. That menu selection authorizes the conversation to create its own task tabs in Chrome;
adopting an existing user tab still requires clicking the extension icon on that tab. In-app import
and profile reset actions are labelled as IAB-only, and opening a page in the system browser is
explicitly not a backend switch.

On a new IAB session, the first `tabs.open(url)` now navigates the exact bootstrap `about:blank`
view instead of stacking a second tab beside it. The placeholder is session-owned and consumed
once; later or concurrent opens retain normal multi-tab behavior.

Finishing a read-only task no longer removes the page named by the final answer. The selected final
result remains visible and becomes user-owned, while unmarked intermediate tabs are cleaned up and
the finished agent is refused if it tries to keep writing to a retained page.

The Browser menu now follows the compact Codex menu rhythm: a tighter rounded panel, clear selected
backend rows, shorter contextual guidance, and grouped in-app data actions. It also exposes working
per-tab zoom controls from 50% to 200%, including one-click reset; the chosen zoom survives a page
reload or renderer rebuild for the lifetime of that tab.

Opening that menu no longer blanks or horizontally reflows the active in-app page. The app captures
a short-lived frozen preview before hiding the native page for click safety, keeps that preview at
the native view's exact integer bounds underneath the menu, and restores the live page when the menu
closes. The preview stays in renderer memory only and is never written to logs or checkpoints.
Import and clear-data dialogs now retain that frozen page behind their dimmed modal instead of
turning the browser area blank. Import kind labels follow the live app locale instead of retaining
the startup Chinese dictionary, and the startup reopen-pages decision uses the full pane rather
than surrounding itself with empty browser chrome.
