# Docs-only pushes no longer run CI

`ci.yml` now carries `paths-ignore` on both its push and pull_request triggers: nothing under
`docs/`, `design/` or `changelog/`, and no root-level markdown (plus `LICENSE`), is reachable
from a build or a test, so a push touching only those files had a ~5-minute CI run with nothing
to verify. Actions minutes are billed on this private repo, and the recent slimming batches were
exactly such pushes.

Two edges are deliberate:

- **Not `**/*.md`.** The skill library's `SKILL.md` files under `packages/skills/skills/` are
  runtime content — loaded by the skills package and asserted on by its tests — so markdown
  under `packages/` still runs CI. Package READMEs ride along with code changes anyway.
- **The skip is all-or-nothing per push.** `paths-ignore` skips the run only when *every*
  changed file matches; a mixed code+docs push still runs CI in full.

Recorded tradeoff: if branch protection ever makes the CI check *required*, a docs-only pull
request would wait forever on a check that never starts. No required checks are configured
today; revisit the ignore list if that changes.
