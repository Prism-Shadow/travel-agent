# @prismshadow/penguin-skills

The built-in skill library. A Skill is a directory with a `SKILL.md` (frontmatter: name, description, version, updated) — files are the runtime source of truth.

Skills follow the "index first, body on demand" design: only their metadata is injected into an Agent's system prompt; the Agent reads the full `SKILL.md` via shell when it actually needs it.

The library is trimmed to what the travel agent actually uses — a single skill, in the order of the `SKILL_GROUPS` manifest in `src/index.ts` (a skill directory missing from the manifest is still loaded, and lands in an "Other" group):

| Group | Skills |
| --- | --- |
| Browser | `penguin-browser` |

The upstream PenguinHarness library (data-analysis, web-design, the agent-tuning loop, …) was removed in the fork's slimming pass; it survives in git history.

## Development

```bash
pnpm --filter @prismshadow/penguin-skills build      # tsup → dist/ (loader API)
pnpm --filter @prismshadow/penguin-skills typecheck
pnpm --filter @prismshadow/penguin-skills test
```
