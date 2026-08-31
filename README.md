# travel-agent

Glue between [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) (agent engine) and penguin-browser (the visible in-app browser plus an optional connection to the user's own Chrome). Ctrip is a demo scene, not the product.

A user says one sentence. The agent searches, reduces the option space to a few representatives with a reason each, waits for a click that is also authorization, then fills the form and stops on the payment page. It does **not** do price watching, auto rebooking, ticket-sniping, or anything that needs a long-lived process.

Architecture, as built: [docs/architecture/iab-in-app-browser.md](docs/architecture/iab-in-app-browser.md).

## Development

Needs Node >= 24 and pnpm 11.

```bash
pnpm install && pnpm build
pnpm dev                 # server + web; data root ~/.penguin/dev-data
```

Dev data is separate from an installed PenguinHarness's `~/.penguin/data`.

Existing `default_agent` instances created before `penguin-browser` was added pick the skill up on the next load. Start a **new** chat after pulling — the system prompt is assembled when the session is created.

The `penguin-browser` CLI must be on `PATH` (`pnpm build` links it). The bundled Skill resolves the
in-tree CLI and uses automatic backend routing, so agent commands honor the Browser menu.

## Status

This repo is a **hard fork** of PenguinHarness `0.2.2` (`d14be6f`). We do not merge that upstream. The engine baseline remains pinned, while the web and desktop experience now evolves as travel-agent's own consumer product surface, informed by the Mindtrip research snapshot
([docs/research/mindtrip.md](docs/research/mindtrip.md)).

`@travel-agent/domain` has been **removed**. It held three things. Two of them — choosing which
options to show, and deciding whether two listings are the same product — were judgements a model
makes better than a hand-maintained rule table, and had sat with no caller through six phases; they
were deleted rather than kept. The third, `submitBooking`, briefly moved into the transaction
experiment described below.

The later `@travel-agent/transaction` package has also been retired. Its only live responsibilities
were not one cohesive transaction abstraction: the interaction-card contract now belongs to the
server API, and browser handover belongs to `penguin-browser`. Its checkpoint, escalation adapter,
WAL, commitment, capability, and payment-execution chain had no reachable production reader or
executor. The invariant that does matter even when the agent is wrong remains at the real action
surface: `penguin-browser` unconditionally blocks payment controls, so the person completes payment.

## Layout

| Package | Role |
| --- | --- |
| `packages/core`, `server` | PenguinHarness engine baseline (pinned snapshot) |
| `packages/web` | travel-agent's active consumer UI, shared by web and desktop |
| `packages/browser-cli`, `browser-extension` | penguin-browser, vendored in |
| `packages/skills/skills/penguin-browser` | How the agent follows the conversation's browser choice |

## Browser backends

The Desktop offers both backends in the right-side Browser menu:

- **In-app browser (default):** every new conversation starts here. It is visible in the app and
  keeps its own persistent cookies and sign-ins.
- **My own Chrome (extension):** choose this between tasks to reuse a Chrome profile. If the bundled
  extension is not connected, the app opens setup. Selecting Chrome permits the agent to create its
  own task tabs; using an already-open Chrome tab still requires clicking the extension icon on that
  tab.

Both backends converge on the same relay and Playwright execution layer; they differ in the debugger
bridge and the browser profile being controlled:

```mermaid
flowchart TB
    Agent["Agent / penguin-browser CLI"] --> Executor["Playwright Executor"]
    Executor <-->|"Standard CDP WebSocket"| Relay["CDP Relay"]

    Relay <-->|"/iab"| IabTransport["IabTransport"]
    IabTransport <-->|"webContents.debugger"| IAB["Electron WebContentsView"]

    Relay <-->|"/extension"| Extension["Chrome Extension"]
    Extension <-->|"chrome.debugger"| Chrome["User's Chrome tab"]
```

The choice is stored per conversation and cannot change while a task runs. Opening the current page
in the system default browser does not switch the agent backend. There is no silent fallback between
the two profiles when the selected backend is unavailable.

## Run the desktop app from source

Running the app requires Node >= 24, pnpm 11, and an API key for a supported model provider.

```bash
git clone https://github.com/Prism-Shadow/travel-agent.git
cd travel-agent
pnpm install
pnpm desktop
```

`pnpm desktop` builds the workspace, starts the embedded server, and opens the Travel Agent desktop
app. The app window signs in as the built-in administrator automatically, and source-run data is
kept under `~/.penguin/dev-data`.

On first use, open **Models** and add an API key for the default model. As an alternative for local
runs, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY` before starting
the app. Then start a new Trip or conversation and describe the travel task. New conversations use
the visible in-app browser by default, so no browser extension is required.

To reuse a signed-in Chrome profile instead, build and load the source-only extension by following
the [browser extension setup](packages/browser-extension/README.md#getting-started), then choose
**My own Chrome (extension)** from the conversation's Browser menu between tasks.
