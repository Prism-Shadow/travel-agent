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

**`penguin-browser` runs but does not block.** 504 of its 551 tests passed; the rest were written
off here as "properties of the runner, not of the code" — wall-clock failures a shared runner would
always produce.

> **Corrected on 2026-08-18.** That was wrong, and diagnosing it instead of routing around it fixed
> all seven. Every one had a definite cause in the tests: a click budget too small to complete a
> single actionability probe, a harness faking dark mode with a per-client emulation the process
> under test could not observe, an unguarded read of a log the healthy run never writes, a third
> party's rendered page height pinned in an inline snapshot, and — the reason the failing *set*
> changed between runs — every suite truncating one shared CDP log that vitest's parallel workers
> were all writing to. The suite now passes 550/550, and no product code changed.
>
> The job stays `continue-on-error` briefly, because the last of those was a race and one green run
> is not proof; it should be folded back into the main job once a few CI runs come back clean.
> Leaving it non-blocking indefinitely would recreate exactly what it was meant to prevent.

A CI that is red for reasons nobody can act on is a CI everyone learns to ignore, and then the one
real failure is ignored with it. Splitting the job bought time to look properly; it was not meant to
be the answer.

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
