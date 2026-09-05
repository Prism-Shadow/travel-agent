# Chrome Web Store Submission Justifications

## Single Purpose Description

Connects browser tabs to local Playwright automation scripts via Chrome DevTools Protocol, allowing users to automate and control their browser for testing and development without launching a separate Chrome instance.

## Permission Justifications

### nativeMessaging

Discovers the selected local Travel Agent application through the registered
`com.prismshadow.travel_browser` host. The host accepts only `list` and `connect` and returns
an authenticated loopback endpoint. It does not receive page contents, execute scripts, or
start a browser relay. Chrome permits only this extension's fixed origin to call it.

### activeTab

Required to attach the Chrome debugger to the current tab when the user clicks the extension icon. This grants the gesture-scoped access needed to adopt that already-open tab; it is separate from task tabs the extension creates after the user selects the Chrome backend or starts a local CLI session.

### debugger

Essential for core functionality. This permission allows the extension to attach Chrome DevTools Protocol (CDP) to two explicitly initiated kinds of tab: an existing tab selected by clicking the extension icon, or a new task tab created after the user selects the Chrome backend in Travel Agent (or starts a standalone local CLI session). CDP access enables the extension to relay local Playwright commands for navigation, element interaction, and testing.

### tabs (Testing Only - Removed in Production Builds)

**Note: This permission is automatically removed during production builds and is only included in test builds.**

The tabs permission is only needed during development/testing to:

- Access the URL property of tabs for test identification (finding tabs by URL pattern)
- Query all tabs with full information for test assertions

In production, the extension functions perfectly without the tabs permission because:

- Tab event listeners (onRemoved, onActivated, onUpdated) work without it
- chrome.tabs.create() and chrome.tabs.remove() work without it
- chrome.tabs.query() for active tab works without it
- chrome.tabs.get() works without it (returns limited info which is sufficient)

The build process (vite.config.mts) automatically removes this permission when TESTING environment variable is not set.

### webNavigation

Required to detect when one tab opens a new tab/window via `window.open`, `target="_blank"`, or similar navigation-triggered tab creation. The extension listens for `chrome.webNavigation.onCreatedNavigationTarget` to build a `new tab id → source tab id` mapping. When a Chrome popup window is created by a Travel Browser-connected tab, the extension uses this mapping to know whether to relocate the popup into the source tab's main window so Playwright automation can control it. No URL or page content is collected — only tab-ID correlations.

### scripting (updated use)

The `scripting` permission was originally added for iframe cleanup before debugger attachment. It is now also used to:

1. **Inject the in-page toolbar** (`initPenguinBrowserToolbar`) into the MAIN world of every tab connected to Travel Browser. The toolbar is a closed Shadow DOM element that floats in the top-right corner and provides quick AI-integration tools (e.g. pin-element copy mode).
2. **Re-inject the toolbar** after page navigations via `chrome.webNavigation.onDOMContentLoaded`.
3. **Destroy the toolbar** when the user disconnects Travel Browser from a tab, so no extension UI is left behind on pages the user is actively browsing.

All injections target only connected tabs: either a tab explicitly adopted with the extension icon or a task tab the extension created following a local user-initiated backend/session choice. Injections use only the top-level frame (`allFrames: false`). No code is injected into unrelated pre-existing tabs.

### host_permissions (<all_urls>)

Required to attach the debugger to tabs on any domain the user chooses to automate. This permission does not allow the extension to modify page content or inject scripts - it only enables CDP debugger attachment for automation. Users need this flexibility to test and automate workflows across all websites.

## Remote Code Justification

**This extension does NOT download, load, or execute any remote code.**

All extension code (JavaScript, HTML, CSS) is fully bundled within the extension package and statically reviewed.

**WebSocket Connection (localhost only):**
The extension establishes a WebSocket connection to an authenticated, application-owned loopback endpoint (or port 19989 in explicit standalone mode). This connection is used exclusively for **message passing** (sending and receiving JSON data), NOT code execution.

**What the WebSocket is used for:**

- Receiving CDP (Chrome DevTools Protocol) command messages in JSON format from local Playwright scripts
- Forwarding these command messages to attached browser tabs via the `chrome.debugger` API
- Sending CDP event messages back to the local Playwright scripts

**What it is NOT used for:**

- Downloading or executing JavaScript, WebAssembly, or any other executable code
- Connecting to external/remote servers (strictly localhost only)
- Loading remote configurations that modify extension behavior

Native Messaging discovers and pairs the application; WebSockets carry the existing CDP transport. The WebSocket serves as a local IPC (inter-process communication) channel, not a remote code delivery mechanism.

## Data Collection & Privacy

- No data is collected or transmitted to external servers
- All browser control happens locally through Chrome DevTools Protocol
- WebSocket connections are loopback-only; Desktop assigns its own port
- Extension operates entirely on the user's machine
- No analytics, tracking, or telemetry

## Screenshots Required

Need to provide at least one screenshot showing:

- Extension icon in toolbar (gray when disconnected, green when connected)
- Extension attached to a tab with Chrome's "debugging this browser" banner visible
- Welcome page or usage demonstration
