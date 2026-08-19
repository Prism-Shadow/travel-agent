# travel-agent — Agent Development Guide

## Core Reminder

Reason from first principles, end to end. When the evidence does not support a conclusion, say
"no basis found" instead of presenting an inference as a finding.

## Product Direction

travel-agent is the glue between **PenguinHarness** (the agent engine) and **penguin-browser** (the
visible in-app browser, plus an optional connection to the user's own Chrome).

The shape of the product is one interaction: a user says one sentence; the agent searches, reduces
the option space to a few representatives **each with a reason**, waits for a click that is also
authorization, fills the form, and **stops on the payment page**.

It does **not** do price watching, auto-rebooking, ticket-sniping, or anything else that needs a
long-lived process. Ctrip is a demo scene, not the product. Do not frame this as a generic
browser-automation platform or a scraping tool.

## Hard Rules

1. **English is the repository's working language** — code, comments, error and log messages, test
   names, package metadata, developer docs. Chinese appears only where it *is* the content: zh i18n
   catalogs (`strings.ts`, `i18n.ts`, `titleZh`), `*.zh.md` documents, and test literals asserting
   CJK behavior.
2. **Every change ships a changelog entry.** Add `changelog/unreleased/YYYY-MM-DD-<semantic-id>.md`
   (H1 title, one-sentence summary, then details) and a one-line link in
   `changelog/unreleased/README.md`. Related changes extend an existing entry instead of opening a
   new file. Released folders are frozen.
3. **The engine baseline is pinned.** `packages/core` and `packages/server` are a hard-fork snapshot
   of PenguinHarness 0.2.2 (`d14be6f`). Do not merge upstream. Do not "improve" them opportunistically
   — changes there are a deliberate decision, not a side effect.
4. **The model judges; code only enforces.** Write enforcement code only where the model is itself
   inside the threat model. `@travel-agent/domain` was deleted for violating this: two of its three
   pieces were judgements a model makes better than a rule table, and had sat with no caller through
   six phases. The third — `submitBooking` — survived precisely because it must hold *even when the
   agent is wrong*, and it moved to `packages/transaction`.
5. **PenguinHarness must not know penguin-browser exists.** The engine provides transaction semantics;
   penguin-browser provides browser control; travel-agent is the only place that joins them
   (`docs/design/001-architecture.md` §3). Do not add a dependency in that direction.
6. **No silent fallback between browser backends.** The choice is per conversation and cannot change
   while a task runs. An unavailable persisted choice stays visible as unavailable; showing the other
   backend would be a false state.
7. **Payment stops at the gate.** The agent does not press the button that takes the money. Gates
   live in `packages/transaction` (`submitBooking`) and
   `packages/browser-cli/src/executor/payment-gate.ts`. When adding a surface that can click, wire it
   through the gate — *enumerate, do not sample* (`write-gate.ts` states the rule).
8. **Read the current file before editing it.** Keep changes scoped to the request; prefer existing
   repo patterns over a new abstraction.

## Repo Layout

```
packages/core, server        PenguinHarness engine baseline (pinned snapshot; @prismshadow/*)
packages/web                 The active consumer UI, shared by web and desktop
packages/desktop             Electron shell: in-app browser, vault, packaging
packages/browser-cli         penguin-browser: CLI, CDP relay, Playwright executor (vendored)
packages/browser-extension   Chrome extension bridging the relay to the user's Chrome (vendored)
packages/transaction         Irreversible-action semantics: WAL, commitments, checkpoints, escalation
packages/skills              Built-in skill library, incl. skills/penguin-browser
```

Both browser backends converge on the same relay and Playwright execution layer; they differ only in
the debugger bridge and the profile being driven. See `docs/architecture/iab-in-app-browser.md`.

## Documentation Map

Read the project's own documents before inferring behavior from code.

| Topic | Document |
| --- | --- |
| Architecture, repo strategy, layer boundaries | [`docs/design/001-architecture.md`](docs/design/001-architecture.md) |
| Single-window in-app browser | [`docs/design/002-codex-style-single-window-iab.md`](docs/design/002-codex-style-single-window-iab.md) |
| Private profile, payment confirmation, redaction | [`docs/design/003-agent-first-private-profile-and-payment-confirmation.md`](docs/design/003-agent-first-private-profile-and-payment-confirmation.md) |
| Production roadmap, capability gates | [`docs/design/004-codex-parity-production-roadmap.md`](docs/design/004-codex-parity-production-roadmap.md) |
| Consumer UI direction (Mindtrip-informed) | [`docs/design/005-mindtrip-benchmark-ui-refactor.md`](docs/design/005-mindtrip-benchmark-ui-refactor.md) |
| In-app browser architecture, as built | [`docs/architecture/iab-in-app-browser.md`](docs/architecture/iab-in-app-browser.md) |
| Phase-by-phase verification evidence | [`docs/verification/`](docs/verification/) |
| Manual QA checklists | [`docs/manual-testing/`](docs/manual-testing/) |
| Known open problems | [`docs/issues/`](docs/issues/) |
| Vendored browser stack history and plans | [`docs/browser/`](docs/browser/) |
| Directory tree with per-path responsibilities | [`docs/project-structure/directory-tree.md`](docs/project-structure/directory-tree.md) |
| Lessons that must not be learned twice | [`tasks/lessons.md`](tasks/lessons.md) |
| Contribution rules, quality gates, release process | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

Records versus living docs: `changelog/`, `docs/verification/` and the numbered design docs are
**dated records** — do not rewrite them to match today's code. READMEs, `CONTRIBUTING.md`,
`docs/architecture/`, `docs/project-structure/` and source comments are **living** — update them in
the same change that makes them wrong.

## Commands

```bash
pnpm install
pnpm build          # build first: core's exports point at dist/
pnpm dev            # backend + web together
pnpm desktop        # Electron shell

pnpm format:check   # CI runs these three on every PR
pnpm typecheck
pnpm test
```

Dev entry points that touch data default to `~/.penguin/dev-data`, separate from an installed app's
`~/.penguin/data`. Never point them at real user state.

## Lessons

[`tasks/lessons.md`](tasks/lessons.md) is the single home for what was expensive to learn — the
failures that cost hours because nothing surfaces them. **Read it before the first change in an
unfamiliar area, and add to it whenever something costs you an hour that one sentence would have
saved.** It is organized as:

| Section | Answers |
| --- | --- |
| Product and behaviour | Backend defaults vs availability, no-silent-fallback, cross-process state, browser-chrome fidelity |
| Build, workspace and layout | Package-relative paths, injected-dependency sync, compiler rules as directories, what a `tsconfig` include actually emits |
| Testing and verification | Cold-start boundaries, establishing a baseline, a suite that fails differently each run, dynamic imports defeating a dead-code search |

Do not restate a lesson in this file. The three documents divide the work: **Hard Rules** above are
absolute and non-negotiable; `tasks/lessons.md` is judgement that has to be applied; `docs/issues/`
is what is still broken.

## Open Issues

| # | Problem |
| --- | --- |
| [0001](docs/issues/0001-extension-open-window-blocked.md) | Extension backend opens a blocked/blank window on Ctrip |
| [0002](docs/issues/0002-browser-cli-redaction-never-wired.md) | design/003 §6.5 redaction is built, tested, and never called — **must be closed before secret entry goes live** |
| [0003](docs/issues/0003-browser-cli-flaky-browser-tests.md) | Two browser-backed tests fail intermittently |
| [0004](docs/issues/0004-browser-cli-scripts-not-typechecked.md) | `browser-cli/scripts/` is unchecked; several files do not compile |
| [0005](docs/issues/0005-injected-workspace-deps-sync-deadlock.md) | Layout changes deadlock the extension build |

## Editing Workflow

1. Gather evidence before writing code — read the existing implementation, the design doc that
   governs it, and the tests that pin it. Search the repo before searching the web.
2. For a simple fix, proceed. For anything crossing packages or touching a gate, write the plan first.
3. Prefer the smallest change that makes the invariant hold. When a change spans layers (schema,
   helper, route; or relay, executor, UI), update them in the same commit.
4. Verify with the real gates — `pnpm typecheck`, the affected package's tests, and a build when the
   change touches paths, layout, or bundling. Record what you ran.
5. Ship the changelog entry with the change, and update any living doc the change made wrong.

## Current State

- Milestones M0–M2 and M4 are done. M3 (one-sentence acceptance run) and M5 (flights) were withdrawn
  on 2026-08-18; the product UI was unfrozen on 2026-08-19 and now evolves as travel-agent's own
  consumer surface under design/005.
- `packages/transaction` is wired: the payment paths in `server` and `desktop` go through
  `submitBooking`.
- Capability gates `vault.l2l3`, `secret_entry.live` and `payments.execute` are **fail-closed**,
  behind the unresolved isolation decision D3 (`docs/verification/isolation.md`). Code may be written
  ahead of them, but issue 0002 must be closed before any of them opens.
- Nothing in this repo publishes to a registry today.
