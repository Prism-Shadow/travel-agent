# Agent working notes leave git: design-qa.md deleted, artifacts/ and tasks/ ignored

`design-qa.md` was a pixel-comparison worklog: its ground truth was a clipboard file under
`/var/folders` (gone on reboot) and its evidence images under `artifacts/` were never tracked,
so as a committed record it was reproducible nowhere but the machine that wrote it. Deleted;
the durable trace of that work is the feature's tests and changelog entries.

`artifacts/` and `tasks/` are now gitignored as local agent workspace, codifying the
convention the working sessions already stated ("intentionally not part of the product
commit"). `tasks/travel-cover-library-192.md`, the one task ledger that had been committed,
is untracked but kept on disk; the plan it serves lives in `docs/design/006`.
