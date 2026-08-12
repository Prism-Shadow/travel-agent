# Penguin Browser MCP

Control your Chrome browser via Model Context Protocol (MCP) using Chrome DevTools Protocol (CDP) events.

This repository currently provides a source-only development build. Build the workspace and load `extension/dist` as an unpacked extension from `chrome://extensions`.

## What is Penguin Browser MCP?

Penguin Browser MCP is a Chrome extension that enables Playwright to connect to your existing Chrome instance without spawning a new browser or requiring Chrome to be started in CDP mode. This allows AI assistants and automation tools to interact with your browser seamlessly through the Model Context Protocol.

## Key Features

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **MCP integration**: Exposes browser control through the Model Context Protocol
- **CDP events**: Full access to Chrome DevTools Protocol capabilities
- **Playwright compatible**: Connect Playwright directly to your running Chrome

## How it Works

1. Install the extension in your Chrome browser
2. Click the extension icon to attach the debugger to the current tab
3. The extension creates a relay connection using CDP
4. Connect your MCP client (like Playwright) to control the browser
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
3. Select `<repository>/extension/dist`.
4. Navigate to a webpage and click the Penguin Browser extension icon.
5. Confirm the tab joins the cyan `penguin-browser` group, then start the local CLI or MCP server.

## Privacy & Security

Penguin Browser MCP runs locally in your browser and does not send any data to external servers. All browser control happens through the standard Chrome DevTools Protocol on your machine.

## Support

See the repository root `README.md`, `MCP.md`, and `docs/QA-FUNCTIONAL-TEST-CHECKLIST.md` for setup, troubleshooting, and the current verification status.

## License

Apache-2.0
