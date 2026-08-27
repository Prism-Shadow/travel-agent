# Issues

Open problems, one per file, numbered `NNNN-slug.md`. An issue records what is broken and what it
costs while that is still true — working state that neither git history (what changed) nor a
postmortem (the finished story) can hold.

## Rules

- One problem per file; living until closed. Update the file as understanding improves.
- Closing an issue means deleting its file in the change that resolves it: the fix's commit records
  the outcome, and an issue that was expensive to find or fix closes into a
  [`../postmortem/`](../postmortem/README.md) story instead of silence.
- Numbers are never reused, including after a file is deleted. The tree does not show the
  high-water mark; find it before numbering a new issue:
  `git log --diff-filter=A --name-only --format= -- docs/issues | sort -u | tail -1`
  — and check `docs/postmortem/` for a number an issue burned without ever being committed
  (opened and closed inside a single change).
- Keep the root `AGENTS.md` open-issues section current in the same change that opens or closes
  an issue.

This file also keeps the folder present when zero issues are open — git drops empty directories,
and every map in the repo links here.
