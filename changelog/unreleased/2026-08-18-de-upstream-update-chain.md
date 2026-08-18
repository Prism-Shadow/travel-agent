# Dead root devDependencies out; the update chain now names this fork, not upstream

**Three root devDependencies had lost their last consumer.** `tsx` existed for the deleted
`penguin` dev script (the server's dev entry declares its own); `vitest` is declared by every
package that tests; the root dev-dependency on `@prismshadow/penguin-core` served the same
deleted script (`dev-prebuild.mjs` only uses package *names* as pnpm filters). All three are
gone from the root manifest. `.env.example` also stops claiming the Claude gateway "defaults
to AgentHub" — the model catalog gives the anthropic provider no gateway default, so an unset
`ANTHROPIC_BASE_URL` means the official endpoint.

**The desktop update chain no longer references upstream anywhere.** This supersedes the
"kept pointing at upstream, left for the release decision" note in the CLI-retirement entry:
pointing the chain at the fork now was strictly better than leaving it aimed at upstream,
because the risk was concrete — `electron-builder.yml`'s publish target
(`Prism-Shadow/penguin-harness`) is what stamps the update metadata into a build, so any
distributed build would have checked upstream's releases and could have replaced itself with
an upstream PenguinHarness. The publish target, desktop `updater.ts`'s releases page, and the
server update-check's `REPO_SLUG` all now name `Youhai020616/travel-agent`. The fork has no
releases, so every check finds nothing and fails soft — the machinery stays testable and
becomes live the day this repo cuts a release.

Also swept out: the upstream `repository` fields in core/server/skills manifests, the staged
desktop app's `homepage`, and the skill-icon hue-override map whose four entries all named
deleted skills.
