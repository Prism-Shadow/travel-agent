# Upstream residue: two more stale e2e specs, the notices file, and the last identity strings

Follow-ups surfaced by a sweep after the CLI retirement.

**Two more web e2e specs still assumed the old skill library** — the same class as
`skills.spec.mjs`, invisible for the same reason (CI does not run web e2e).
`project-switch.spec.mjs` used `agent-creation` as its cross-project manage-install fixture;
`draft.spec.mjs` opened the slash menu on the `/agent` prefix, which only the deleted
`agent-*` skills matched — it now opens on the bare `/` and anchors on `/penguin-browser`,
keeping the absent-`/agent`-command assertion non-vacuous.

Running the suite live also caught a **pre-existing spec bug** the trim did not cause:
uninstalling from the manage-install modal now asks for confirmation ("installed files,
local edits included, are deleted"), and `skills.spec.mjs` never clicked the confirm button —
it had been failing since that dialog shipped. The spec now confirms. All three specs pass
against the built web app and a live server.

**`THIRD-PARTY-NOTICES.md` deleted.** Its own opening line said everything: nothing listed
was part of the repository — the Node runtime and MinGit were downloaded by `release.yml`
into the CLI release archives. That workflow left on 2026-08-17 and the archives' contents
left with the CLI; the file described artifacts that can no longer be produced. If a desktop
release later bundles third-party programs, its notices get written for what it actually
ships.

**Last identity strings.** The desktop Help menu's "Project on GitHub" now opens this fork
instead of upstream, and the root `package.json` stops calling itself
`penguin-harness … (SDK + CLI)` — the only place left that did.
