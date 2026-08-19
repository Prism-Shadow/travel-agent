# AGENTS.md: what an agent has to know before touching this repo

A root `AGENTS.md` now states the product direction, the rules that are not negotiable, and the
failures that cost hours because nothing surfaces them.

It is deliberately not a directory listing — `docs/project-structure/directory-tree.md` already is
one. What it carries instead is the knowledge that is expensive to rediscover:

- **The boundaries that are decisions, not accidents.** The engine baseline is a pinned fork and is
  not merged from upstream; PenguinHarness must not learn that penguin-browser exists; the model
  judges and code only enforces, which is why `@travel-agent/domain` was deleted and `submitBooking`
  was not; there is no silent fallback between browser backends; the agent does not press the button
  that takes the money.
- **Records versus living documents.** `changelog/`, `docs/verification/` and the numbered design
  docs are dated records and are not rewritten to match today's code. READMEs, `CONTRIBUTING.md`,
  `docs/architecture/` and source comments are living and must be corrected in the same change that
  makes them wrong.
- **The open issues table**, so the first response to a strange failure is to check whether it is
  already known — including the browser suite's non-reproducibility, which otherwise reads as "my
  change broke it".

Every path and command in it was checked against the tree it describes.

## `tasks/` is tracked, and holds the lessons

The hard-won specifics — package-relative paths that encode a file's depth, injected dependencies
that deadlock a layout change, compiler rules written as filename lists, a suite that fails
differently each run — live in `tasks/lessons.md` rather than being restated in `AGENTS.md`. The
three documents now divide the work explicitly: `AGENTS.md` carries what is absolute,
`tasks/lessons.md` carries judgement that has to be applied, `docs/issues/` carries what is still
broken.

That required `tasks/` to leave `.gitignore`, where it had been put earlier the same day: a lesson
file that exists on one machine teaches nobody. `artifacts/` stays ignored — it is regenerated
binary capture, not knowledge.

## The `/AGENTS.md` ignore rule

Upstream ignored `/design`, `/AGENTS.md` and `/CLAUDE.md` as per-developer local files. Two of the
three no longer apply here: `/design` is gone (the records moved to `docs/design/`), and `AGENTS.md`
is now repository knowledge rather than one contributor's preferences. `CLAUDE.md` stays ignored.
Without this the file would have been silently absent from every commit that claimed to add it.
