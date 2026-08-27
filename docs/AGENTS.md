# AGENTS.md — Where prose lives

Every fact has one home. Find the row whose job matches before writing; link the home from
everywhere else. A new top-level folder under `docs/` updates this table and the map in the root
[AGENTS.md](../AGENTS.md) in the same change.

| Home | Job | Lifecycle |
| --- | --- | --- |
| Root [`SPEC.md`](../SPEC.md) | The product's goal, its requirements, and the scope it declines — the root of the spec graph | Living |
| Root [`AGENTS.md`](../AGENTS.md) | Standing orders for agents: hard rules, repo map, workflow | Living |
| [`architecture/`](architecture/README.md) | How the shipped system works now — read before changing what it maps | Living |
| `packages/*/SPEC.md` | What a module owns, and what it may depend on — the per-module contract | Living |
| [`decisions/`](decisions/README.md) | Agent Notes: what was decided, why, and what was given up | Lifecycle folders; implemented notes keep facts current |
| [`issues/`](issues/) | Open problems, numbered `NNNN-slug.md` | Living until closed; an expensive one closes into a postmortem |
| [`postmortem/`](postmortem/README.md) | Full incident stories — the only home for war-story narrative | Frozen once landed |
| [`research/`](research/) | Dated competitor and product snapshots | Frozen |
| [`../changelog/`](../changelog/unreleased/README.md) | What shipped, one entry per change (Hard Rule 2) | Frozen once released |
| [`../tasks/lessons.md`](../tasks/lessons.md) | One-sentence what-to-do-differently; links the postmortem that owns the story | Living |
| [`../tasks/`](../tasks/README.md) | In-flight plans and working ledgers for cross-session work | Living while the work is; deleted when it ships (the changelog keeps the record) or graduated to `decisions/` |
| Package READMEs | How to run and develop that package: commands, environment, operational notes | Living |

Placement in one line: what the product must do → root `SPEC.md`; what a module owns → that module's
`SPEC.md`; how the shipped system fits together → `architecture/`; rationale and trade-offs →
`decisions/`; what shipped → `changelog/`; still broken → `issues/`; the story of how it broke →
`postmortem/`; the compressed warning → `tasks/lessons.md`; the plan for work still in flight →
`tasks/`.

## The spec graph

Spec files are the ones whose frontmatter carries `id` and `type`; they form a graph through
`parent` and `depends-on`, and `spec_grep` / `spec_graph` / `spec_validate` navigate it. A module's
node is a `SPEC.md` beside the code it describes.

One rule keeps this from becoming a second, competing system of record:

> **A spec node states what is true now, indexed by module. It never carries history, rationale, or
> a story.**

So a spec says the payment gate has no enable flag; it does not say why that was chosen over the
alternatives (`decisions/`), when it shipped (`changelog/`), or how it once failed
(`postmortem/`) — it links to them by id or path. A spec that starts narrating is drifting into a
row above it.

Today the graph covers the four packages carrying travel-agent's own concepts — `server`, `web`,
`desktop`, `browser-cli` — plus the two architecture documents and the root. `core`, `skills` and
`browser-extension` have no node: `core` is a pinned upstream snapshot this project does not design,
and a contract document for a package nobody is redesigning would be a document with no reader.
Add a node when someone needs it, not to complete a picture.

## Writing rules

- **Living docs state current fact, not history.** No "previously / now / no longer" — the change
  story belongs in `changelog/`, a decision note, or a postmortem.
- **Frozen records are never rewritten to match today's code.** They may cite files that no longer
  exist; that is what dating is for.
- **Cross-reference with relative markdown links**, never bare filenames or numbers, so references
  are mechanically checkable and survive moves.
- **English everywhere**, with the exact exceptions listed in root AGENTS.md Hard Rule 1.
- **Folder contracts are `README.md`; subtree-wide standing orders are `AGENTS.md`.** A README
  states the rules of its own folder and renders where it lives; an AGENTS.md governs more than
  the folder that holds it — this file routes prose across `docs/`, `../changelog/` and
  `../tasks/`.
- Source comments do not cite the deleted `design/00X` spec series — the comment states its
  contract in its own words; git history holds the old spec. (Upstream-engine citations of the
  form `Docs: /docs/… § …` are PenguinHarness's own convention and stay.)
