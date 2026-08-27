# The project gains a spec graph: what each module owns, indexed by module

This repository recorded **decisions** and **history** better than most, and **structure** not at
all. `docs/decisions/` answers "why is it like this?" indexed by date; nothing answered "what does
this module own, and what may it depend on?" indexed by module. That asymmetry is why a deletion
contract could be stated wrongly in four places for a day, and why three source comments could point
at a decision note that had moved.

The layer meant to carry it — package READMEs, which the tier table called "the per-package
contract" — was not carrying it. Measured before the change: `desktop` and `browser-cli` had no
README at all; `server`'s and `web`'s opened "The PenguinHarness Web backend" and "The PenguinHarness
Web App" and closed "Part of PenguinHarness", describing the upstream engine's developer console
rather than this product; `web`'s feature list omitted `trips`, the product's first-class object,
from the package that renders it.

Details:

- **A spec graph of seven nodes**, navigable with `spec_grep` / `spec_graph` / `spec_validate`. A
  file is a node when its frontmatter carries `id` and `type`; `parent` and `depends-on` are the
  edges. `SPEC.md` at the root states the product's goal, its requirements, and a scope table of
  what it adopts and declines with the reason for each — recovering the adopt/do-not-adopt reasoning
  that was written in the retired Trip plan and deleted with it.
- **The two architecture documents became nodes in place**, gaining frontmatter with their prose
  untouched. Re-creating them as new spec files would have broken say-it-once on the first day.
- **Four module SPECs**, for the packages carrying travel-agent's own concepts: `server`, `web`,
  `desktop`, `browser-cli`. Each states what the module owns and its boundary, and links rather than
  restates the decision notes behind it.
- **One rule prevents a second system of record**, now in the tier table: *a spec node states what
  is true now, indexed by module; it never carries history, rationale, or a story.* Those keep their
  existing homes and are referenced.
- **Two boundary facts are now stated precisely**, both finer than the prose that stated them
  before. Hard Rule 5 holds mechanically — neither `core` nor `server` depends on `penguin-browser` —
  but `core/src/state/default-config.ts`, the engine's default system prompt, names the
  `penguin-browser` Skill and both backends, so a reader grepping the engine finds hits that are not
  violations. And `web`'s README claim of type-only imports is true of the server DTOs and false of
  `core`: `stream-controller.ts` imports the value guards `isEventMessage` and `isPartialPayload`,
  among twenty web files importing from core.
- **The package-README row changed job** from "the per-package contract" to "how to run and develop
  that package". The three upstream-flavoured READMEs were left as they are — they belong to a
  separate README pass — and their eight links to `penguin.ooo`, a site deleted on 2026-08-17,
  are recorded there.
- `AGENTS.md` § Product Direction is now four lines and a pointer to `SPEC.md`, so scope judgements
  and standing orders stop sharing a file and a change cadence.
- **`.prettierignore` gains `.thinkrail/`.** The agent scratch directory is git-ignored by its own
  nested `.gitignore`, and Prettier reads only the root one — so a working file there failed
  `pnpm format:check` for a reason unrelated to any change. It never reached CI (git ignores it),
  which is precisely why it would have been diagnosed slowly.

Deliberately not done, against this repository's twice-paid lesson about mechanism arriving before a
caller: no node for `core`, `skills` or `browser-extension` (`core` is a pinned snapshot this project
does not design); no submodule nodes; and no CI check — `spec_validate` runs on demand, and a gate is
added when drift is observed with the system in use, not before.

Verified: `spec_validate` reports no dangling links, duplicate ids or parent cycles;
`spec_graph` from the root returns all seven nodes with six parent edges; `pnpm typecheck` green
across all seven packages, with no source file changed.
