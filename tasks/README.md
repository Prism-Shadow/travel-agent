# tasks/ — In-flight plans and working ledgers

Tracked on purpose: a plan that exists on one machine teaches nobody.

- [`lessons.md`](lessons.md) — what must not be learned twice; permanent, governed by its own row
  in [the tier table](../docs/AGENTS.md).
- `todo.md` — the active working plan; the code workflow writes and updates it.
- Other `*.md` — plans and batch ledgers for work not yet shipped.

A plan lives here only while its work is in flight: when the work ships, the plan is deleted — the
commit keeps the record — and a plan that decided a revisitable boundary graduates to
[`../docs/decisions/`](../docs/decisions/README.md) first. English throughout (Hard Rule 1);
binary working evidence belongs in gitignored `artifacts/`, never here.
