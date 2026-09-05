# Travel Browser

Control your Chrome browser via Model Context Protocol (MCP) using Chrome DevTools Protocol (CDP) events.

This repository currently provides a source-only development build. Build the workspace and load `packages/browser-extension/dist` as an unpacked extension from `chrome://extensions`.

## Welcome page

The install page at `src/welcome.html` introduces Travel Browser with the shared route-penguin
logo and three steps: pin the extension, select Chrome in Travel Agent, and send a travel request.
Existing-tab authorization is explained separately. Connection status, privacy, troubleshooting,
and optional CLI/MCP setup live in expandable help sections.

The page uses bundled assets only, follows the system color scheme, and adapts to narrow screens.
English and Chinese follow the browser language on first visit; the language switch saves a
local preference for later visits. It does not query browser connection state or claim the
illustration is a live status display. Build it with `pnpm --filter penguin-browser-extension build`;
both extension variants include the page and its local stylesheet and script.

## Display name and existing installations

Chrome shows **Travel Browser** as the extension name and as the title of its cyan task-tab
groups. The installation page, in-page toolbar, context menu and Desktop setup prompts use the
same name. The `penguin-browser` CLI command, package identifiers, manifest key and installation
identity remain stable.

After rebuilding, click **Reload** on the extension in `chrome://extensions`; do not remove and
reinstall it. Reconnect the task tabs as needed. Group synchronization applies the current title
to each recorded extension-owned group. User-created groups are never adopted or renamed just
because their title matches either `penguin-browser` or Travel Browser.

## Application pairing

Keep the updated Travel Agent Desktop running. It registers a local connection helper for the
current OS user and owns a private relay. The extension discovers that application through Chrome
Native Messaging, remembers its installation, and reconnects to its new endpoint after restart.
It does not compete for the standalone CLI port or connect to another application when its paired
application is unavailable. Multiple running applications require a choice in **Connection** on
the welcome page, also available through the extension's **Options** menu.

After an update, restart Desktop and reload the extension in `chrome://extensions`; enable it if
Chrome asks about the new Native Messaging permission. Both `dist` and `dist-packaged` default to
Desktop pairing. `dist-packaged` only suppresses the automatic welcome tab. A test/custom-port
build defaults to standalone mode. Existing tab authorization is preserved across a reconnect to
the same application; explicitly changing the application or mode disconnects the previous tabs.

For independent CLI development, choose **Standalone CLI** in Connection settings and explicitly
set `PENGUIN_BROWSER_PORT=19989` for CLI commands if Desktop is also open. A custom-port extension
build and CLI must use the same port. CLI auto-start does not terminate an occupied listener.

Desktop repairs the current user's host registration on startup. Before uninstalling, run the
application executable with `--unregister-travel-browser-host` (in development:
`pnpm --filter @prismshadow/penguin-desktop exec electron . --unregister-travel-browser-host`).
Removal retains any registration subsequently written by another installation. Host registration
covers Chrome, Chrome for Testing and Chromium on macOS/Linux, and Chrome's HKCU key on Windows.
The [architecture](../../docs/architecture/iab-in-app-browser.md#application-discovery-and-pairing)
describes the protocol and its boundaries.

## Versioning

Travel Browser has separate release domains:

- `manifest.json` is the monotonically increasing Chrome extension release sequence. The private extension package metadata stays equal to it so the repository has one extension version.
- `packages/browser-cli/package.json` is the CLI/relay release and compatibility-build version. The extension reports that value to the relay so mismatched runtime builds can warn.
- The repository root version is the Travel Agent product release. It does not replace either browser version.

Reloading an unpacked extension keeps its installation identity, but removing and loading it again creates a new identity. A temporarily disconnected session remains visible as `DISCONNECTED` and automatically recovers when the same installation reconnects. If the original installation will not return—for example, after removal and reinstallation—delete the old session and create a new one after authorizing a tab in the current installation. Account email, profile labels, and browser names are never used to migrate a session automatically. Legacy extension builds without an installation ID must be rebuilt/reloaded before they can create a persistent session safely.

## What is Travel Browser?

Travel Browser is a Chrome extension that enables Playwright to connect to your existing Chrome instance without spawning a new browser or requiring Chrome to be started in CDP mode. This allows AI assistants and automation tools to interact with your browser seamlessly through the Model Context Protocol.

## Key Features

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **MCP integration**: Exposes browser control through the Model Context Protocol
- **CDP events**: Full access to Chrome DevTools Protocol capabilities
- **Playwright compatible**: Connect Playwright directly to your running Chrome

## Travel Agent browser choice

Travel Agent Desktop defaults every new conversation to its visible in-app browser. To use this
extension instead, the user selects **Chrome extension** from the browser pill after Budget on a
new draft, before the first message. Existing conversations offer **My own Chrome (extension)**
from the right-side Browser menu between tasks. That selection authorizes the conversation to create its own task tabs in the
connected Chrome profile. It does not adopt arbitrary existing tabs.

To let the agent use a Chrome tab that is already open, click the Travel Browser icon on that tab.
That action authorizes only that existing tab. Backend selection and existing-tab authorization are
separate by design.

## How it Works

1. Install the extension in your Chrome browser
2. Select Chrome in Travel Agent or start a standalone local CLI session
3. The extension creates a relay connection using CDP
4. The agent may create a task tab; click the extension icon if it should use a tab already open
5. Chrome places connected tabs in the cyan **Travel Browser** tab group; the extension badge shows the number of connected tabs.

## Use Cases

- Browser automation without disrupting your workflow
- AI-assisted web browsing and testing
- Debugging and development with MCP-enabled tools
- Remote browser control for various applications

## Permissions

This extension requires the following permissions:

- **nativeMessaging**: To discover and pair with the local Travel Agent application
- **debugger**: To access Chrome DevTools Protocol
- **scripting**: To inject the in-page Travel Browser toolbar and helpers
- **tabs**: To manage browser tabs
- **tabGroups**: To show the explicitly connected tabs as a cyan group
- **tabCapture/offscreen**: To record an explicitly connected tab
- **host access**: To work with sites the user explicitly connects

## Getting Started

1. From the repository root, run `pnpm install && pnpm build`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `<repository>/packages/browser-extension/dist`.
4. In Travel Agent Desktop, choose **Chrome extension** after Budget on a new draft. For an existing
   conversation, use **My own Chrome (extension)** in the Browser menu between tasks. For standalone
   use, first choose **Standalone CLI** in extension Connection settings, then start the local CLI or MCP server.
5. To adopt an existing webpage, open it and click the extension icon; confirm that it joins the
   cyan **Travel Browser** group.

## Privacy & Security

The extension connects to Travel Agent through a local relay, and your Chrome profile stays on your device. Page content used for a task may be sent to the configured model provider, while websites receive normal browsing traffic. Local browser control does not mean all task processing is offline.

## Support

See the repository root `README.md`, `MCP.md`, and `docs/QA-FUNCTIONAL-TEST-CHECKLIST.md` for setup, troubleshooting, and the current verification status.

## License

Apache-2.0
