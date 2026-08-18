# The upstream terminal CLI is retired, and the installer chain goes with it

`packages/cli` shipped five subcommands, and an audit against the product found no live
consumer for any of them. The desktop app never went through the CLI — it forks
`penguin-server` directly as a utilityProcess — so the CLI's only role in the product was as
a bundled bonus command (`penguin`) exposed on PATH. Of the subcommands: `chat` was the
upstream terminal product surface (and the bulk of the package); `run`'s main business
consumer was the agent-tuning loop whose skills were deleted in the library trim;
`serve`/`config` duplicated `pnpm dev` and the web UI; and `update` was actively wrong —
it downloads release artifacts from **upstream's** GitHub releases and Alibaba OSS bucket
(`REPO_SLUG = "Prism-Shadow/penguin-harness"`), so running it from this fork would replace
the install with an upstream PenguinHarness build.

**The installer chain was one unit with the CLI and left with it.** `install.sh` /
`install.ps1` / `install.cmd` installed the standalone CLI bundle, from the same upstream
sources; the 2026-08-17 decision to keep them ("still the programs that would install a
CLI build if one is ever cut") collapsed once there is no CLI to build. The release-script
family under `scripts/` (`test-installer.*`, `package-release-bundles.sh`,
`publish-release-to-oss.sh`, `install-ossutil.sh`, `test-oss-staging.sh`) served the
already-deleted publishing workflows and is gone too. `pre-release.yml` keeps its Windows
build/typecheck/test job — the cross-platform release risks are real — and loses the two
installer jobs. design/001 §3's installer-retention line carries a dated reversal note.

**Desktop now bundles one CLI, not two.** The stage script, launcher generators, deb
postinst/postrm templates, and the "Install CLI Commands" flow all now expose only
`penguin-browser`; the `penguin` launcher, its PATH plumbing, and the workspace dependency
on `@prismshadow/penguin-cli` are removed. `posixLauncherScript` / `windowsLauncherScript`
/ `appImageWrapperScript` default to the penguin-browser entry.

**What deliberately stays.** The server's `POST /api/version/update` route re-ran the CLI
via `PENGUIN_CLI_ENTRY`; nothing sets that variable any more, so the route always answers
"unsupported" — it is inert, tested, and kept until the fork's own release path is
decided. The same applies to `GET /api/version/update-check`
(`services/update-check-service.ts`) and desktop's `updater.ts`: **both still point at
upstream's releases** and will report upstream versions as updates if upstream ever
publishes again. They are the remaining upstream-pointing surface, left for the release
decision rather than half-removed here.

Also in this batch: the web e2e spec `skills.spec.mjs` — missed by the library trim
because CI does not run web e2e — is rewritten against the one-skill library, and the new
`docs/project-structure/directory-tree.md` no longer lists the removed files.
