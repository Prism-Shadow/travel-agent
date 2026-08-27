# travel-agent — Agent Development Guide

## Core Reminder

Reason from first principles, end to end. When the evidence does not support a conclusion, say
"no basis found" instead of presenting an inference as a finding.

## Product Direction

travel-agent is an **open-source consumer travel application** built on **PenguinHarness** (the
agent engine) and **penguin-browser** (the visible in-app browser, plus an optional connection to
the user's own Chrome). It is the only place those two are joined. Its first-class object is the
**Trip**; the interaction it is judged on is one sentence → a few represented options, each with a
reason → a click that is also authorization → the form filled → **a stop at the payment page**.

The goal, the requirements that keep that sentence true, and the scope table of what this product
adopts and declines — with the reason for each — are the root of the spec graph:
**[`SPEC.md`](SPEC.md)**. Read it before proposing a feature; it is what settles whether the
feature belongs here at all.

## Hard Rules

1. **English is the repository's working language.** Everything you write is English — code,
   comments, commit messages, error and log output, test names and fixtures, package metadata, and
   every document under `docs/` and `tasks/`, and every spec. This is not a preference about style; a
   comment or design note that only some readers can parse is documentation that does not exist for
   the rest of them.

   Chinese appears only where it **is** the content, never where it *describes* the content:

   | Allowed | Because |
   | --- | --- |
   | zh i18n catalogs and fields — `strings.ts`, `i18n.ts`, `titleZh`, `short_description_zh` | The string *is* the product's Chinese UI |
   | `*.zh.md` documents (`README.zh.md`) | A deliberate translation, paired with an English original |
   | Test literals asserting zh output or CJK behavior | The literal is the thing under test |

   Some older documents under `docs/` are still Chinese and are being translated. Do not add to
   them in Chinese, and translate the file you are editing if the change is substantial.
2. **Every change leaves the specs true.** There is no changelog. **What changed** is git history —
   write the commit message as the entry: what changed, why, and what you ran to verify it.
   **What is true** is the spec graph, rooted at [`SPEC.md`](SPEC.md) — a change that alters a
   boundary, a contract or a decision updates the owning spec in the *same commit*, and one that
   settles a trade-off worth remembering adds a note under `docs/decisions/`. A spec left describing
   the old behaviour is part of the defect, not a follow-up.
3. **The engine baseline is pinned.** `packages/core` and `packages/server` are a hard-fork snapshot
   of PenguinHarness 0.2.2 (`d14be6f`). Do not merge upstream. Do not "improve" them opportunistically
   — changes there are a deliberate decision, not a side effect.
4. **The model judges; code only enforces.** Write enforcement code only where the model is itself
   inside the threat model. `@travel-agent/domain` was deleted for violating this: two of its three
   pieces were judgements a model makes better than a rule table, and had sat with no caller through
   six phases. The later `packages/transaction` experiment was retired for the same reason: its
   active interaction contract belongs to the server, browser handover belongs to browser-cli, and
   its payment execution machinery had no reachable production executor.
5. **PenguinHarness must not know penguin-browser exists.** The engine provides the agent runtime;
   penguin-browser provides browser control; travel-agent is the only place that joins them.
   Do not add a dependency in that direction.
6. **No silent fallback between browser backends.** The choice is per conversation and cannot change
   while a task runs. An unavailable persisted choice stays visible as unavailable; showing the other
   backend would be a false state.
7. **Payment stops at the gate.** The agent does not press the button that takes the money. The
   enforced production gate lives in `packages/browser-cli/src/executor/payment-gate.ts` and has no
   enable flag. When adding a surface that can click, wire it through the gate — *enumerate, do not
   sample* (`write-gate.ts` states the rule).
8. **Read the current file before editing it.** Keep changes scoped to the request; prefer existing
   repo patterns over a new abstraction.

## Repo Layout

```
packages/core, server        PenguinHarness engine baseline (pinned snapshot; @prismshadow/*)
packages/web                 The active consumer UI, shared by web and desktop
packages/desktop             Electron shell: in-app browser, vault, packaging
packages/browser-cli         penguin-browser: CLI, CDP relay, Playwright executor (vendored)
packages/browser-extension   Chrome extension bridging the relay to the user's Chrome (vendored)
packages/skills              Built-in skill library, incl. skills/penguin-browser
```

`browser-cli` and `browser-extension` are a snapshot of upstream `penguin-browser` at `ba9e13b`
(2026-08-12): upstream history stays in the upstream repo; post-import changes are in this
repository's git history.

Both browser backends converge on the same relay and Playwright execution layer; they differ only in
the debugger bridge and the profile being driven. See `docs/architecture/iab-in-app-browser.md`.

## Worktrees

Linked worktrees live inside the checkout at `.worktree/<task>` — `git worktree add
.worktree/<task> -b <branch>` — never as sibling directories outside it. The directory is
git-ignored and its contents are never committed from the main tree. Once a worktree's branch
has merged, remove the folder: `git worktree remove .worktree/<task>`.

## Documentation Map

Read the project's own documents before inferring behavior from code.

| Topic | Document |
| --- | --- |
| What the product must do, and the scope it declines | [`SPEC.md`](SPEC.md) |
| What a module owns and may depend on | that package's `SPEC.md` |
| Where any piece of prose belongs (the tier table) | [`docs/AGENTS.md`](docs/AGENTS.md) |
| Project architecture, as built | [`docs/architecture/README.md`](docs/architecture/README.md) |
| In-app browser architecture, as built | [`docs/architecture/iab-in-app-browser.md`](docs/architecture/iab-in-app-browser.md) |
| Decision records: the why and what was given up | [`docs/decisions/`](docs/decisions/README.md) |
| Full incident stories | [`docs/postmortem/`](docs/postmortem/README.md) |
| Known open problems | [`docs/issues/`](docs/issues/) |
| Competitor and product research snapshots | [`docs/research/`](docs/research/) |
| Lessons that must not be learned twice | [`tasks/lessons.md`](tasks/lessons.md) |
| In-flight plans and working ledgers | [`tasks/`](tasks/README.md) |

Specs are navigable as a graph: a file whose frontmatter carries `id` and `type` is a spec node,
linked by `parent` and `depends-on`, and the `spec_*` tools walk it. A spec states what is true now
and never narrates — the rule, and what is deliberately not yet a node, are in
[`docs/AGENTS.md`](docs/AGENTS.md).

Records versus living docs: git history, `docs/research/` and `docs/postmortem/` are
**dated records** — do not rewrite them to match today's code. READMEs, the specs,
`docs/architecture/`, `docs/decisions/` and source comments are **living** —
update them in the same change that makes them wrong (an implemented decision note keeps its facts
current; the decision itself is superseded by a new note, never rewritten).

## Commands

Needs Node >= 24 and pnpm 11. Copy `.env.example` to `.env` for model credentials in development.

```bash
pnpm install
pnpm build          # build first: core's exports point at dist/
pnpm dev            # backend + web together
pnpm desktop        # Electron shell

pnpm format:check
pnpm typecheck
pnpm test

npx playwright install chromium                   # once, for the e2e suites
pnpm --filter @prismshadow/penguin-web test:e2e   # browser e2e against a mock LLM
pnpm test:e2e                                     # core live-model e2e; needs DEEPSEEK_API_KEY
```

## The gate before a push

**GitHub Actions CI is paused** (`ci.yml`, disabled manually on 2026-08-27; re-enable with
`gh workflow enable ci.yml`). Nothing verifies a push but this, so run it — all of it, not the part
that looks related:

```bash
node packages/desktop/scripts/check-debug-switches.mjs && \
pnpm build && pnpm format:check && pnpm typecheck && pnpm test && \
pnpm --filter @prismshadow/penguin-web test:e2e && \
pnpm --filter @prismshadow/penguin-desktop test:e2e && \
pnpm test:e2e
```

About twenty minutes, most of it the web browser suite, and it reproduces every CI step except
one: **Linux**. The in-app browser e2e
needs `xvfb-run` only on Linux and runs natively on macOS; the live-model e2e needs
`DEEPSEEK_API_KEY` in `.env` (leave `ANTHROPIC_API_KEY` empty, or the run takes the Claude path
instead of the one CI used).

The web browser suite is in that list as of 2026-08-28, and its absence is why it is worth naming
here: `pnpm test` does not run Playwright, and neither this gate nor `ci.yml` invoked
`packages/web/e2e` at all, so twenty-one of its specs were free to go red and stay red without a
single gate noticing. A suite nothing runs is not a slower gate; it is a suite that does not
exist.

**That step fails today.** Nineteen of those specs are still red — issue
[0010](docs/issues/0010-web-browser-e2e-is-red.md) — so this gate cannot currently be run to
completion, and nothing may be pushed on the strength of it. The step is listed anyway rather than
held back until the specs are fixed: a suite kept out of the gate to keep the gate green is
precisely how these nineteen became invisible, and the cost of that is now written down instead of
repeated.

Two things this gate does **not** cover, and neither is a reason to skip it:

- **Linux-only behaviour** — Electron's sandbox under the AppArmor userns restriction, path and
  line-ending differences. `pre-release.yml` (manual) holds the Windows suite for the same reason.
- **The agent loop.** `pnpm test:e2e` is one test: it asks a real model for a short reply and checks
  the stream and the token usage. It proves the model is reachable. It does not prove a task runs
  end to end — that acceptance run was withdrawn on 2026-08-18 and has no replacement.

Re-enable CI before anything ships.

Every `dev:*` command runs `scripts/dev-prebuild.mjs` first, behind a lock that serializes
concurrent invocations: it keeps `pnpm install` current, prebuilds the workspace deps, dedupes
back-to-back builds so `pnpm dev` installs and builds exactly once, and clears the web app's Vite
dep cache when skills or core output changed — that cache is keyed by lockfile and config only, so
it would otherwise keep serving the browser the previous core.

Dev entry points that touch data default to `~/.penguin/dev-data`, separate from an installed app's
`~/.penguin/data`. Never point them at real user state.

CI is three workflows. `ci.yml` runs on every push to main and every pull request — **paused
today**, see the gate above. `pre-release.yml` is manual and holds what is only worth paying for
before a build ships — the Windows suite. `desktop-build.yml` is manual too, and nothing calls it
since the upstream release chain was removed; it produces the three-OS Electron installers as
workflow artifacts. This repository is private, so Actions minutes are billed, and Windows bills at
2x, macOS at 10x: a full `ci.yml` run is 16 billed minutes across its three jobs, which at four to
nine pushes a day is what made pausing worth considering. Pushing once per batch of commits costs
one run instead of one per push, and is the lever that does not trade away verification.

Pull requests branch from `main` and keep to one topic; new user-facing behaviour comes with tests,
and with the spec update that keeps Hard Rule 2 true.

## Agent Artifacts

Product Design QA is local working evidence, not repository documentation. When a Product Design
workflow requires `design-qa.md`, write it to `artifacts/design-qa/design-qa.md` instead of the
repository root, and keep its supporting screenshots and comparison files in the same directory.
`artifacts/` is gitignored and must not be committed.

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

Do not restate a lesson in this file. The four documents divide the work: **Hard Rules** above are
absolute and non-negotiable; `tasks/lessons.md` is judgement that has to be applied; `docs/issues/`
is what is still broken; `docs/postmortem/` is the full story a lesson compresses — a lesson links
its postmortem when one exists.

## Open Issues

| # | Problem |
| --- | --- |
| [0008](docs/issues/0008-active-session-lags-one-conversation.md) | The pane's active session lags one conversation behind (stale-writer unpinned); impact reduced to a late strip render since the visibility gate was retired |
| [0010](docs/issues/0010-web-browser-e2e-is-red.md) | Nineteen `packages/web/e2e` specs assert a product from before the trip sidebar; the suite ran nowhere until it joined the gate, so **the gate cannot pass until they are fixed** |

## Editing Workflow

1. Gather evidence before writing code — read the existing implementation, the decision note that
   governs it (`docs/decisions/`), and the tests that pin it. Search the repo before searching the
   web.
2. For a simple fix, proceed. For anything crossing packages or touching a gate, write the plan first.
3. Prefer the smallest change that makes the invariant hold. When a change spans layers (schema,
   helper, route; or relay, executor, UI), update them in the same commit.
4. Verify with the real gates — `pnpm typecheck`, the affected package's tests, and a build when the
   change touches paths, layout, or bundling. Record what you ran.
5. Write the commit message as the record — what changed, why, what you ran — and update every spec
   and living doc the change made wrong, in that same commit.

## Current State

- Milestones M0–M2 and M4 are done. M3 (one-sentence acceptance run) and M5 (flights) were withdrawn
  on 2026-08-18; the product UI was unfrozen on 2026-08-19 and now evolves as travel-agent's own
  consumer surface.
- Interaction cards are owned by `packages/server`; browser handover and the unconditional payment
  stop are owned by `packages/browser-cli`. There is no agent-triggered payment execution path.
- Capability gates `vault.l2l3` and `secret_entry.live` are **fail-closed**,
  behind the unresolved isolation decision D3
  (`docs/decisions/proposed/2026-08-16-agent-runtime-isolation.md`). Code may be written
  ahead of them; the four ordinary browser outputs are wired through redaction, but that guardrail
  does not substitute for the unresolved runtime boundary.
- Nothing in this repo publishes to a registry today.
