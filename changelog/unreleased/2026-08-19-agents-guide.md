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
- **Four traps, each with its measurement.** Injected workspace dependencies deadlocking a layout
  change; `path.join(__dirname, '..')` encoding a file's depth; page-context code being excluded
  from `tsc` by directory; tests in `src/` being compiled and published. Each links to the issue or
  the module that documents it.
- **The open issues table**, so the first response to a strange failure is to check whether it is
  already known — including the browser suite's non-reproducibility, which otherwise reads as "my
  change broke it".

Every path and command in it was checked against the tree it describes.
