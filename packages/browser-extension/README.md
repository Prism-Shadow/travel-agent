# Penguin Browser MCP

Control your Chrome browser via Model Context Protocol (MCP) using Chrome DevTools Protocol (CDP) events.

This repository currently provides a source-only development build. Build the workspace and load `packages/browser-extension/dist` as an unpacked extension from `chrome://extensions`.

## Versioning

Penguin Browser has separate release domains:

- `manifest.json` is the monotonically increasing Chrome extension release sequence. The private extension package metadata stays equal to it so the repository has one extension version.
- `packages/browser-cli/package.json` is the CLI/relay release and compatibility-build version. The extension reports that value to the relay so mismatched runtime builds can warn.
- The repository root version is the Travel Agent product release. It does not replace either browser version.

Reloading an unpacked extension keeps its installation identity, but removing and loading it again creates a new identity. A temporarily disconnected session remains visible as `DISCONNECTED` and automatically recovers when the same installation reconnects. If the original installation will not return—for example, after removal and reinstallation—delete the old session and create a new one after authorizing a tab in the current installation. Account email, profile labels, and browser names are never used to migrate a session automatically. Legacy extension builds without an installation ID must be rebuilt/reloaded before they can create a persistent session safely.

## What is Penguin Browser MCP?

Penguin Browser MCP is a Chrome extension that enables Playwright to connect to your existing Chrome instance without spawning a new browser or requiring Chrome to be started in CDP mode. This allows AI assistants and automation tools to interact with your browser seamlessly through the Model Context Protocol.

## Key Features

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **MCP integration**: Exposes browser control through the Model Context Protocol
- **CDP events**: Full access to Chrome DevTools Protocol capabilities
- **Playwright compatible**: Connect Playwright directly to your running Chrome

## Travel Agent browser choice

Travel Agent Desktop defaults every new conversation to its visible in-app browser. To use this
extension instead, the user selects **My own Chrome (extension)** from the right-side Browser menu
between tasks. That selection authorizes the conversation to create its own task tabs in the
connected Chrome profile. It does not adopt arbitrary existing tabs.

To let the agent use a Chrome tab that is already open, click the Penguin Browser icon on that tab.
That action authorizes only that existing tab. Backend selection and existing-tab authorization are
separate by design.

## How it Works

1. Install the extension in your Chrome browser
2. Select Chrome in Travel Agent or start a standalone local CLI session
3. The extension creates a relay connection using CDP
4. The agent may create a task tab; click the extension icon if it should use a tab already open
5. Chrome places connected tabs in the cyan `penguin-browser` tab group; the extension badge shows the number of connected tabs.

## Use Cases

- Browser automation without disrupting your workflow
- AI-assisted web browsing and testing
- Debugging and development with MCP-enabled tools
- Remote browser control for various applications

## Permissions

This extension requires the following permissions:

- **debugger**: To access Chrome DevTools Protocol
- **scripting**: To inject the in-page Penguin Browser toolbar and helpers
- **tabs**: To manage browser tabs
- **tabGroups**: To show the explicitly connected tabs as a cyan group
- **tabCapture/offscreen**: To record an explicitly connected tab
- **host access**: To work with sites the user explicitly connects

## Getting Started

1. From the repository root, run `pnpm install && pnpm build`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `<repository>/packages/browser-extension/dist`.
4. In Travel Agent, choose **My own Chrome (extension)** in the Browser menu. For standalone use,
   start the local CLI or MCP server.
5. To adopt an existing webpage, open it and click the extension icon; confirm that it joins the
   cyan `penguin-browser` group.

## Privacy & Security

Penguin Browser MCP runs locally in your browser and does not send any data to external servers. All browser control happens through the standard Chrome DevTools Protocol on your machine.

## Support

See the repository root `README.md`, `MCP.md`, and `docs/QA-FUNCTIONAL-TEST-CHECKLIST.md` for setup, troubleshooting, and the current verification status.

## License

Apache-2.0
