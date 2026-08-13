# travel-agent

Glue between [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) (agent engine) and penguin-browser (control of the user's own Chrome). Ctrip is a demo scene, not the product.

A user says one sentence. The agent searches, reduces the option space to a few representatives with a reason each, waits for a click that is also authorization, then fills the form and stops on the payment page. It does **not** do price watching, auto rebooking, ticket-sniping, or anything that needs a long-lived process.

Design: [design/001-architecture.md](design/001-architecture.md).

## Status

This repo is a **hard fork** of PenguinHarness `0.2.2` (`d14be6f`). We do not merge that upstream. The engine stays; the downstream identity does not.

| Milestone | Meaning | State |
| --- | --- | --- |
| M0 | Browser stack in-tree, Ctrip hotel page loads | done |
| M1 | Human handoff (`requestHelp`) | done |
| M2 | Transaction layer (WAL / commitment / checkpoint / escalation) | library done |
| M3 | One sentence → stop on the payment page | **open** — form primitives work; listing extraction and the host glue do not |
| M4 | Tab ownership + cross-site offer alignment | library done |
| M5 | Flights | not started |

`@travel-agent/domain` and `@travel-agent/transaction` are not wired into the agent loop yet. The libraries are tested; the product path is not.

## Layout

| Package | Role |
| --- | --- |
| `packages/core`, `cli`, `server`, `web` | PenguinHarness engine and UI (frozen snapshot) |
| `packages/browser-cli`, `browser-extension` | penguin-browser, vendored in |
| `packages/transaction` | Irreversible-action semantics |
| `packages/travel-domain` | Representatives, alignment, guarded booking |
| `packages/skills/skills/penguin-browser` | How the agent is supposed to drive Chrome |

## Development

Needs Node >= 24 and pnpm 11.

```bash
pnpm install && pnpm build
pnpm dev                 # server + web; data root ~/.penguin/dev-data
```

Dev data is separate from an installed PenguinHarness's `~/.penguin/data`.

Existing `default_agent` instances created before `penguin-browser` was added pick the skill up on the next load. Start a **new** chat after pulling — the system prompt is assembled when the session is created.

The `penguin-browser` CLI must be on `PATH` (`pnpm build` links it). The skill still talks about a standalone checkout; that path is stale.

## What this is not

- Not a Ctrip / Fliggy client.
- Not a fork we intend to send back to PenguinHarness as a product.
- Not signed desktop builds of PenguinHarness (those live upstream).
