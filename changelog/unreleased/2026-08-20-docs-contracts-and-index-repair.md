# Contract READMEs for docs/issues/ and tasks/, and the unreleased index repaired

A one-off mechanical scan of the prose tree (link resolution, naming, index coverage) surfaced
drift that convention alone had not caught; this change fixes what it found and writes down the
two missing folder contracts. The scanner itself is not kept — no standing enforcement was
wanted, in CI or locally; the documentation rules remain convention, applied by the writer and
the reviewer.

## What the scan caught

- Five phase entries (phase 3 through phase 6, 2026-08-15/16) had no summary line in
  `changelog/unreleased/README.md`; the lines are restored.
- Closing the last open issue deleted `docs/issues/` entirely — git drops empty directories —
  which dangled the folder links in both AGENTS.md maps.

## docs/issues/ gets its contract

`docs/issues/README.md` — the one prose home that had no contract file — now states the rules
that were previously implicit: one problem per file, close by deleting the file in the fixing
change, expensive closes become postmortems, and numbers are never reused — the high-water mark
survives only in git history, so the README records how to find it. The file also keeps the
folder present when zero issues are open.

## tasks/ gets its contract

The tier table gains a `../tasks/` row and `tasks/README.md` states it: in-flight plans and
working ledgers, tracked because a plan that exists on one machine teaches nobody; a plan is
deleted when its work ships (the changelog keeps the record), graduating to a decision note first
when it decided a revisitable boundary. The writing rules also name the naming law the tree
already follows: folder-scoped contracts are `README.md`, subtree-wide standing orders are
`AGENTS.md`. `tasks/**` joins `ci.yml`'s `paths-ignore` — nothing under it is reachable from a
build or a test.
