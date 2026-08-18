# Upstream baggage removed: README assets, release history, and 18 of 19 library skills

A slimming pass over what the hard fork carried along but this product never uses. Three cuts,
ordered by weight.

**The skill library is now one skill.** The upstream library shipped 19 skills and preinstalled 17
of them into every new `default_agent` — vllm, ollama, llamafactory, bento-slides, web-design,
data-analysis, the four-skill agent-tuning loop, and so on. Those are the skills of a
general-purpose AI workbench, not of a travel agent, and their cost was not disk: every
description was injected into the system prompt of every session via `{{SKILL_METADATA}}`, paying
tokens and offering the model irrelevant tools on each run. The library keeps exactly
`penguin-browser` — the one skill the product is built around — in a single `browser` group.

The trim reached the tests that pinned the old catalogue. Assertions on the four-group manifest
collapsed to the one-group shape; install/uninstall/reinstall fixtures that used `penguin-sdk` /
`penguin-cli` / `agent-creation` now use `penguin-browser`; the two content-assertion suites for
the deleted agent-tuning skills went with their skills. Two capabilities lost their only library
fixture and their coverage narrowed rather than pretend otherwise: no library skill carries
auxiliary `reference/` files any more (the collection path in `readSkillDir` keeps its unit
coverage in core's `agent-skills` tests via synthetic fixtures), and no library skill sets
`preinstall: false` (the filter logic is still asserted, against an all-preinstalled library).
Marker/title/goal tests that used skill names as opaque fixture strings were left alone — they
never depended on the library.

Existing dev-data agents are unaffected by the library trim: installed skills live in the agent's
own state directory, so previously installed upstream skills stay until manually uninstalled; only
newly created agents see the one-skill set.

**Upstream release history left the tree.** `changelog/0.1.0`–`0.2.2` (66 files) documented
PenguinHarness's releases up to the fork baseline `d14be6f`; this fork's own record starts in
`changelog/unreleased/`. The root `CHANGELOG.md` now says exactly that and nothing else. The one
code comment that pointed into the removed folders (`use-panel-width.ts`, a scheduled-removal
note referencing the 0.1.5 backward-compatibility entry) now says the entry lives in git history.

**`assets/readme/` deleted.** Six images — light/dark benchmark SVGs and per-language RAG-app
screenshots — that upstream's README embedded via `prefers-color-scheme` `<picture>` tags. This
fork's README stopped referencing them at the hard-fork commit, and the scripts that generated
them left with `packages/landing`; they were unreferenced and unregenerable.
