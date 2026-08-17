# CI is rebuilt for this fork

The workflows were PenguinHarness's, inherited whole and never run here — this repository is
private, and its Actions history is empty. Two facts about *this* fork, neither true upstream,
decided the new shape.

**Actions minutes are billed on a private repository, with multipliers**: Linux 1×, Windows 2×,
macOS 10×. The inherited layout ran a full duplicate of build/typecheck/test on `windows-latest` for
every push *and* every pull request — 6 minutes at 2× against the Ubuntu job's 6 at 1×, so the
duplicate cost more than the thing it duplicated. Roughly 18 billed minutes per run, and a pull
request that gets merged runs twice.

**Nothing here publishes.** `release.yml` (33 KB) pushed the CLI to the public npm `@prismshadow`
scope and mirrored it to an Alibaba OSS bucket; `oss-staging.yml` verified OIDC access to that same
bucket. Both belong to PenguinHarness. Neither is this fork's to publish to, and the npm Trusted
Publisher is configured against upstream's repository, so a tag here would have failed at auth.

## Now

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | every push to main, every PR | Ubuntu: security guard → build → Prettier → tsc → unit tests → in-app browser e2e. Plus two side jobs (below). |
| `pre-release.yml` | manual | Windows build/typecheck/test + PowerShell parse + Windows installer; POSIX installer suite. |
| `desktop-build.yml` | manual | Unchanged three-OS Electron matrix. Its caller was `release.yml`; the `workflow_call` trigger is kept for a future release workflow of this fork's own. |

Removed: `release.yml`, `oss-staging.yml`. (`pages.yml` went earlier the same day with the site it
deployed.)

Roughly 18 billed minutes per run become about 6.

## Two decisions worth stating rather than burying

**`penguin-browser` runs but does not block.** 504 of its 551 tests pass reliably; the rest drive a
real Chromium through the relay and fail on wall-clock — `page.click: Timeout 500ms exceeded`, an
assertion that the machine prefers a dark colour scheme, a 60-second editor timeout. Those are
properties of the runner, not of the code, and on a shared runner they would have been red from the
first run. A CI that is red for reasons nobody can act on is a CI everyone learns to ignore, and
then the one real failure is ignored with it. So that package has its own `continue-on-error` job:
visible, reported, not a gate. **This is debt, and it is recorded as debt** — the fix is to make
those tests deterministic, or to skip them under CI explicitly at the test where the reason can be
read, and then fold the job back in.

**Windows moved to pre-release.** The Windows-specific risks here are real — path handling, CRLF,
PowerShell syntax in the installer, and DPAPI, which the browser import uses to unwrap Chrome's key
and where Chrome 127+ App-Bound Encryption is refused. But they are *release* risks: none of them
changes from one pull request to the next, and all of them must hold before a build ships. The trade
is that a Windows-only regression is now found later. That is the cost of the saving, stated plainly.

## A gap this opens

`design/004` Phase 6 planned to ship three-platform signed builds via `release.yml`. That workflow is
gone, so **Phase 6 now needs a distribution decision before it can start**: private GitHub Releases,
internal distribution, and where the auto-update feed lives. `desktop-build.yml` still has the matrix
and the signing chain; what is missing is the layer that calls it and delivers what it produces. The
roadmap has been annotated rather than left to be discovered.

## Kept from upstream's design, deliberately

The step order (security guard first because it is fast and its failure is severe; build before
typecheck because core's exports point at `dist/`), the step-level secret so no earlier step or
third-party action can read the API key, the in-shell skip because `secrets` cannot be used in an
`if:`, and the in-app browser end-to-end that refuses to skip when `CI=true` — a test that may
excuse itself for environmental reasons is a test that goes green without running.
