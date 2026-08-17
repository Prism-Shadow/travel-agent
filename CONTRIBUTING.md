# Contributing to travel-agent

This guide covers the workspace setup, daily commands, quality gates, and the
repo's working rules. The execution engine is a hard fork of PenguinHarness
0.2.2 — we do not merge that upstream. See [design/001-architecture.md](design/001-architecture.md) §3.

## Prerequisites

- Node >= 24
- pnpm 11 (`corepack enable` or `npm install -g pnpm`)

## Setup and daily commands

```bash
pnpm install
pnpm build       # build first: core's exports point at dist/

pnpm dev         # backend + web app together (prefixed logs, deps built once)
pnpm dev:server  # backend at 127.0.0.1:7368 (not the installed server's 7364)
pnpm dev:web     # web app (Vite) at 127.0.0.1:7365, /api proxied to 7368
pnpm penguin ... # CLI from source; `penguin web` serves at 127.0.0.1:7369
```

Every dev command runs `scripts/dev-prebuild.mjs` first, which (behind a lock that
serializes concurrent invocations) **keeps `pnpm install` current automatically** — a
fresh clone or a pulled lockfile change installs before starting, and an up-to-date tree
pays nothing (the lockfile hash is stamped) — then prebuilds the workspace deps (skills,
core) with back-to-back builds deduped: starting `dev:server` and `dev:web` at the same
time (or just `pnpm dev`) installs and builds exactly once. When that build changes
skills/core output, the prestep also clears the web app's Vite dep cache
(`packages/web/node_modules/.vite`), which is keyed by lockfile/config only and would
otherwise keep serving the browser the previous core.

One rule when bypassing the dev commands: **rebuild skills/core through pnpm, in that
order** (`pnpm build`, or restart `pnpm dev`) — the workspace uses injected dependencies
(`injectWorkspacePackages` in pnpm-workspace.yaml), so web/server consume snapshot copies
that only re-sync when the package's `build` script runs via pnpm
(`syncInjectedDepsAfterScripts`). A bare `npx tsup` in packages/core updates
`packages/core/dist` but leaves those snapshots — and any already-populated Vite dep
cache — on the old build; if a running dev web app still serves stale core after a manual
rebuild, delete `packages/web/node_modules/.vite` and restart.

Dev entry points that touch data (`pnpm dev`, `pnpm dev:server`, `pnpm penguin`) default
to a separate data root, `~/.penguin/dev-data`, kept apart from the installed CLI/server's
`~/.penguin/data` — hacking on the repo never mixes state with your real agents. Export
`PENGUIN_HOME` to point them anywhere else; an explicit value always wins.

Copy `.env.example` to `.env` for model credentials in development.

## Repo layout

A pnpm monorepo (TypeScript, Node >= 24). One install ships four layers that share a
single data directory (`~/.penguin/data`) and a single message protocol (OmniMessage):

| Package                              | Name                          | Role                                                                                                    |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)     | `@prismshadow/penguin-core`   | SDK & engine: ReAct loop, OmniMessage protocol, LLM/Environment interface contracts, Agent State, Trace |
| [`packages/cli`](packages/cli)       | `@prismshadow/penguin-cli`    | The `penguin` command: REPL, one-shot runs, model & vault config, service launcher                      |
| [`packages/server`](packages/server) | `@prismshadow/penguin-server` | Web backend: HTTP API + SSE streaming, multi-user auth, Project authorization, usage stats              |
| [`packages/web`](packages/web)       | `@prismshadow/penguin-web`    | Web App: multi-session chat, Agent/skill/model management, Trace observability, evaluation center       |
| [`packages/skills`](packages/skills) | `@prismshadow/penguin-skills` | Built-in skill library (includes `penguin-browser`)                                                     |
| [`packages/browser-cli`](packages/browser-cli) | `penguin-browser`     | Browser CLI, CDP relay, Playwright executor                                                             |
| [`packages/browser-extension`](packages/browser-extension) | `penguin-browser-extension` | Chrome extension that attaches the relay to the user's Chrome                          |
| [`packages/transaction`](packages/transaction) | `@travel-agent/transaction` | WAL journal, commitments, checkpoints, escalation, the `submitBooking` gates              |

Responsibilities split by source of truth: the **SDK** owns protocol and execution
(message parsing, the agent loop, tools), the **Server** owns the multi-user runtime
(auth, SSE streaming, scheduled tasks), and the **file layer** under `~/.penguin/data`
owns everything editable and recorded (prompts, Skills, secrets, Traces). The full map
is in [design/001-architecture.md](design/001-architecture.md).

## Quality gates

CI runs all of these on every PR — run them locally before pushing:

```bash
pnpm format:check   # prettier
pnpm typecheck
pnpm test           # unit suites for every package
```

End-to-end suites (optional locally, slower):

```bash
npx playwright install chromium                      # once
pnpm --filter @prismshadow/penguin-web test:e2e      # browser e2e against a mock LLM
pnpm test:e2e                                        # core live-model e2e, needs DEEPSEEK_API_KEY
```

## Working rules

- **English is the repository's working language** — code, comments, error/log messages,
  test names and fixtures, package metadata, and developer docs. Chinese appears only
  where it is the content itself: zh i18n catalogs and fields (`strings.ts` dictionaries,
  CLI `i18n.ts`, `titleZh`, `short_description_zh`), `*.zh.md` documents, and test
  literals that assert zh i18n output or exercise CJK-specific behavior.
- **Every change ships with a changelog entry**: add
  `changelog/<version>/YYYY-MM-DD-<semantic-id>.md` under the next unreleased version
  (released versions' folders are frozen) — an H1 title, a one-sentence summary
  paragraph, then details — and add a one-line link for it to that version's index,
  `changelog/<version>/README.md`. The layout is documented in
  [`changelog/README.md`](changelog/README.md). Related changes may share one entry
  file (extending its details) instead of opening a new file per small change.
- **A release ships its own announcement**: `changelog/<version>/RELEASE.md` is published
  verbatim as the GitHub Release body. Write it during release preparation and **commit it
  before creating the tag** — the release workflow reads it from the tag's checkout, so a
  file added later never reaches the Release page. Without it the workflow falls back to
  GitHub's auto-generated notes.
- **Release prep bumps the product version**: the same `release: X.Y.Z` PR that renames
  `changelog/unreleased/` bumps the root and the public PenguinHarness packages shipped by
  that release (`skills`, `core`, `server`, and `cli`), plus core's `VERSION` constant
  (`packages/core/src/index.ts`). Browser packages are private, independently versioned
  exceptions: `browser-cli` carries the CLI/relay compatibility version, while
  `browser-extension/package.json` stays equal to `browser-extension/manifest.json`'s
  monotonic Chrome release sequence. The release workflow refuses a tag push whose product
  version does not match the repo's, so a forgotten bump fails before anything is published
  (v0.2.1 was tagged with a 0.2.0 repo, and every dev build nagged about an update until the
  repo caught up).
- travel-agent does not maintain the PenguinHarness landing or docs sites. Both
  packages were removed on 2026-08-17, together with the Pages workflow that
  deployed penguin.ooo. The repo's own `install.sh` / `install.ps1` and
  `release.yml` are unrelated to that site and stay.

## Pull requests

- Branch from `main`; keep PRs focused on one topic.
- Make sure CI is green (build, format, typecheck, tests) and describe user-visible
  changes in the PR body.
- New user-facing behavior should come with tests, and with docs updates when it changes
  documented behavior (README, `design/`).
