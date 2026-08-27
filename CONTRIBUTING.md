# Contributing to travel-agent

This guide covers the workspace setup, daily commands, quality gates, and the
repo's working rules. The execution engine is a hard fork of PenguinHarness
0.2.2 — we do not merge that upstream. See the Hard Rules in [AGENTS.md](AGENTS.md).

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

Dev entry points that touch data (`pnpm dev`, `pnpm dev:server`) default to a separate
data root, `~/.penguin/dev-data`, kept apart from an installed app's `~/.penguin/data`
— hacking on the repo never mixes state with your real agents. Export
`PENGUIN_HOME` to point them anywhere else; an explicit value always wins.

Copy `.env.example` to `.env` for model credentials in development.

## Repo layout

A pnpm monorepo (TypeScript, Node >= 24). One install ships four layers that share a
single data directory (`~/.penguin/data`) and a single message protocol (OmniMessage):

| Package                              | Name                          | Role                                                                                                    |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)     | `@prismshadow/penguin-core`   | SDK & engine: ReAct loop, OmniMessage protocol, LLM/Environment interface contracts, Agent State, Trace |
| [`packages/server`](packages/server) | `@prismshadow/penguin-server` | Web backend: HTTP API + SSE streaming, multi-user auth, Project authorization, usage stats              |
| [`packages/web`](packages/web)       | `@prismshadow/penguin-web`    | Web App: multi-session chat, Agent/skill/model management, Trace observability, evaluation center       |
| [`packages/skills`](packages/skills) | `@prismshadow/penguin-skills` | Built-in skill library (includes `penguin-browser`)                                                     |
| [`packages/browser-cli`](packages/browser-cli) | `penguin-browser`     | Browser CLI, CDP relay, Playwright executor                                                             |
| [`packages/browser-extension`](packages/browser-extension) | `penguin-browser-extension` | Chrome extension that attaches the relay to the user's Chrome                          |

Responsibilities split by source of truth: the **SDK** owns protocol and execution
(message parsing, the agent loop, tools), the **Server** owns the multi-user runtime
(auth, SSE streaming, scheduled tasks), and the **file layer** under `~/.penguin/data`
owns everything editable and recorded (prompts, Skills, secrets, Traces).

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
- **Every change leaves the specs true, and the commit is the record.** There is no changelog.
  Write the commit message as the entry — what changed, why, and what you ran to verify it — and
  update the owning `SPEC.md` in the same commit when a boundary, a contract or a decision moves.
  See root [`AGENTS.md`](AGENTS.md) Hard Rule 2 and [`docs/AGENTS.md`](docs/AGENTS.md) for where
  each kind of prose belongs.
- **Nothing here is released today.** No workflow publishes to a registry and no release has been
  cut from this fork, so there is no version-bump or announcement procedure to follow. When that
  changes, it is designed then — not inherited from upstream's.
- travel-agent does not maintain the PenguinHarness landing or docs sites. Both
  packages were removed on 2026-08-17, together with the Pages workflow that
  deployed penguin.ooo, and — later the same day — upstream's `release.yml` and
  `oss-staging.yml`, which published to the public npm `@prismshadow` scope and an
  Alibaba OSS bucket that are not this fork's to publish to. Nothing in this repo
  publishes anything today. The upstream terminal CLI (`packages/cli`) and its
  standalone installers (`install.sh` / `install.ps1` / `install.cmd`) were retired
  on 2026-08-18: the product surface is the desktop app, and those installers only
  fetched upstream's releases.
- CI is two workflows. `ci.yml` runs on every push to main and every pull request
  (Ubuntu: security guard, build, style, typecheck, tests, in-app browser e2e).
  `pre-release.yml` is manual and holds what is only worth paying for before a
  build ships — the Windows suite. This repo is private, so Actions minutes are
  billed, and Windows bills at 2x, macOS at 10x.

## Pull requests

- Branch from `main`; keep PRs focused on one topic.
- Make sure CI is green (build, format, typecheck, tests) and describe user-visible
  changes in the PR body.
- New user-facing behavior should come with tests, and with docs updates when it changes
  documented behavior (README, `docs/`).
