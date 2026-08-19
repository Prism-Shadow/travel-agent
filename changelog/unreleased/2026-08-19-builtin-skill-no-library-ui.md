# penguin-browser becomes built-in; the skill-library UI is removed

## What changed

- **Built-in skill policy (core).** The library's preinstalled skill set (today: `penguin-browser` alone) is now installed into **every** Agent at initialization — not just `default_agent` — and `loadOrInitAgentState` re-syncs it for every Agent on load: a missing copy is reinstalled, a copy whose frontmatter version is behind the library is refreshed, and a same-or-newer (possibly user-edited) copy is left alone. Uninstalling via the API still works, but the skill returns the next time the Agent state is loaded — that is what "built-in" means. Presets can still carry extra skills; a preset copy of the same name wins over the library copy at init.
- **Skill-library UI removed (web).** The sidebar and collapsed-rail "Skills / 技能库" nav entries, the `/skills` route, and the skill-library page (browse groups, manage installs per Agent, quick invoke) are gone — with the one skill built into every agent, a browse-and-install surface had nothing left to do. The composer's skills dropdown, slash invocation (`/penguin-browser`), the `[use_skills]` banner, and the Agent settings Skills tab (zip import/export, uninstall, prompt-injection config) all stay.
- **Server API unchanged** aside from comments: `GET /api/skills` (library catalog) and the per-agent install/uninstall/archive routes still exist; the web app simply no longer uses the library-browse pair (`getSkillLibrary` / `installAgentSkills` were dropped from the web endpoint layer).

## Why

The fork ships exactly one skill, and it is core capability (browser driving), not an optional add-on. A library page whose only content is mandatory anyway was pure navigation noise; making the set built-in also fixes newly created agents starting without the browser skill.

## Tests

- Core `builtin-agents.test.ts`: a plain new Agent now expects the preinstalled set, and the sync-on-load test covers non-default agents.
- Server `skills.test.ts`: every agent starts with the built-in set; archive-mechanics tests that need an empty skills dir strip it first (`createBareAgent`).
- E2E: `skills.spec.mjs` now starts from the composer (built-in install asserted via API, no nav entry expected), `layout.spec.mjs` expects 7 rail entries, and `project-switch.spec.mjs` drops the library-page snapshot regression that page took with it. `web/test/skill-outdated.test.ts` was removed along with the page exporting its subject.
