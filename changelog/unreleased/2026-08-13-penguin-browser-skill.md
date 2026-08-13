# penguin-browser skill: this checkout, not a standalone repo

The preinstalled skill still told the agent to look for `PENGUIN_BROWSER_REPO=…/penguin-browser`. That path does not exist in travel-agent. Version 4 points at `penguin-browser` on PATH or `packages/browser-cli/dist/cli.js`, and the extension at `packages/browser-extension/dist`.

`default_agent` now refreshes a preinstalled skill when the library version is newer, so an existing agent picks up this text on the next load.
