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
| M4 | Tab ownership | done; cross-site offer alignment dropped (see below) |

The open milestones that used to follow (M3, the one-sentence acceptance run; M5, flights)
were withdrawn on 2026-08-18. On 2026-08-19 the product UI was formally unfrozen: the engine
baseline remains pinned, while the web and desktop experience now evolves as travel-agent's own
consumer product surface. [Design 005](design/005-mindtrip-benchmark-ui-refactor.md) records the
Mindtrip-informed direction and its boundaries.

`@travel-agent/transaction` is wired in: the payment paths in `packages/server` and
`packages/desktop` go through its `submitBooking` gates.

`@travel-agent/domain` has been **removed**. It held three things. Two of them — choosing which
options to show, and deciding whether two listings are the same product — were judgements a model
makes better than a hand-maintained rule table, and had sat with no caller through six phases; they
were deleted rather than kept. The third, `submitBooking`, moved into `@travel-agent/transaction`,
because it is not a judgement at all: it is the enforcement that has to hold *even when the agent is
wrong*. That line — the model judges, code only enforces, and code is written only where the model
is itself inside the threat model — is the rule we now apply before adding any "domain" logic.

## Layout

| Package | Role |
| --- | --- |
| `packages/core`, `server` | PenguinHarness engine baseline (pinned snapshot) |
| `packages/web` | travel-agent's active consumer UI, shared by web and desktop |
| `packages/browser-cli`, `browser-extension` | penguin-browser, vendored in |
| `packages/transaction` | Irreversible-action semantics, incl. the `submitBooking` gates |
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
