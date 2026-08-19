# Docs reorganized into tiers: decisions, postmortems, and one home per fact

The `docs/` tree now assigns every kind of prose one home — living references, lifecycle decision
records, incident stories, and frozen records — replacing a layout that mixed genres and had no
place for proposals or closed-issue narratives.

## New structure

- `docs/AGENTS.md` — the tier table: which folder owns which kind of fact, its lifecycle, and the
  writing rules (current-state prose in living docs, frozen records never rewritten, relative
  links).
- `docs/decisions/` — Agent Notes with a lifecycle (`proposed/`, `implemented/`, `rejected/`;
  `archived/` deferred until volume demands it). Format: `Status:` header, `## Problem` opener,
  mandatory `## Alternatives considered`. Implemented notes keep facts current in the same change
  that alters them; a decision is superseded by a new note, never rewritten. A note complements —
  does not replace — the per-change changelog entry (Hard Rule 2 unchanged).
- `docs/postmortem/` — numbered full incident stories, written when closing an expensive issue;
  `tasks/lessons.md` stays the compressed index and links the story, so agents meet the warning
  first.

## Removed

- `docs/design/001–006` — the early design-doc series is deleted (superseded direction and known
  research flaws); frozen records that cite those paths keep their citations as history.
- `docs/manual-testing/` — phase QA checklists deleted.
- `docs/project-structure/directory-tree.md` — deleted; the repo layout summary in root
  `AGENTS.md` remains.
- `docs/browser/` — deleted. Its two files were static mirrors of the upstream `penguin-browser`
  changelogs, frozen at import (the extension mirror had stopped at 0.0.97 while 0.0.107 was
  imported); upstream history stays in the upstream repo and in git. The snapshot provenance
  (`ba9e13b`, 2026-08-12) moved to the root `AGENTS.md` repo layout, and the `relay-state.ts`
  source comment now cites the decision note instead of the deleted plan file.
- `docs/verification/` — deleted. `phase-00–06` were evidence records for the withdrawn phased
  roadmap whose plan and QA checklists are gone; git holds them. `isolation.md` was never a
  verification record — its own text says "decision record" — and is retrofitted as
  `docs/decisions/proposed/2026-08-16-agent-runtime-isolation.md`, the live authority for the
  unresolved D3 gate; root `AGENTS.md`, issue 0002 and the one `executor.ts` phase citation now
  point at current homes.
- The spec-citation sweep that followed: every spec reference in source — 88 in the explicit
  `design/00X` form, 108 pure parenthetical cites in the bare `00X §Y` form (auto-stripped), and
  146 remaining lines (hand-rewritten) — is rewritten to self-contained prose
  across comments, user-facing refusal strings, and test names. Two files with non-UTF-8 bytes
  were patched at the byte level. One test pinned the citation itself (`feature-flags.test.ts`
  asserted a denial reason matches `/003/`); it now pins the mechanism (`/refuses to start/`).
  Upstream-engine citations (`Docs: /docs/… § …`) are PenguinHarness's own convention and stay;
  `docs/AGENTS.md` states the rule.

## Migrated

- `docs/browser/plan-centralize-relay-state.md` →
  `docs/decisions/implemented/2026-08-12-centralize-relay-state.md`. Investigation showed the
  vendored plan had already shipped (zustand store, pure transitions in `relay-state.ts`,
  `extensionKeyIndex` removed) with two deviations now recorded as fact: pending-request
  bookkeeping moved into the store, and the planned single `store.subscribe()` cleanup never
  shipped.

## Follow-ups in the same reorganization

- `docs/architecture/README.md` — the project-level architecture map that the folder claimed but
  never had (it held only the IAB subsystem doc): process topology, the agent's browser chain, the
  money path, the boundaries, and where the depth lives. The IAB doc stays as the subsystem
  reference; the root and docs maps now list both.
- Issue [0006](../../docs/issues/0006-core-exec-session-env-pollution.md) filed: a core
  exec-session test asserts on the first output chunk and fails on machines whose npm stack prints
  a startup warning — surfaced by the full core run during the citation sweep, not caused by it.

## Reference updates

Root `AGENTS.md` (documentation map, records-vs-living rule, lessons division, issue table,
workflow), `README.md`, `README.zh.md`, `CONTRIBUTING.md`, `docs/architecture/iab-in-app-browser.md`,
issues `0001`/`0002`, and two task files no longer cite the deleted paths; living docs are now
self-contained where they used to lean on design-doc sections.
