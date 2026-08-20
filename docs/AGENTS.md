# AGENTS.md — Where prose lives

Every fact has one home. Find the row whose job matches before writing; link the home from
everywhere else. A new top-level folder under `docs/` updates this table and the map in the root
[AGENTS.md](../AGENTS.md) in the same change.

| Home | Job | Lifecycle |
| --- | --- | --- |
| Root [`AGENTS.md`](../AGENTS.md) | Standing orders for agents: hard rules, repo map, workflow | Living |
| [`architecture/`](architecture/README.md) | How the shipped system works now — read before changing what it maps | Living |
| [`decisions/`](decisions/README.md) | Agent Notes: what was decided, why, and what was given up | Lifecycle folders; implemented notes keep facts current |
| [`issues/`](issues/) | Open problems, numbered `NNNN-slug.md` | Living until closed; an expensive one closes into a postmortem |
| [`postmortem/`](postmortem/README.md) | Full incident stories — the only home for war-story narrative | Frozen once landed |
| [`research/`](research/) | Dated competitor and product snapshots | Frozen |
| [`../changelog/`](../changelog/unreleased/README.md) | What shipped, one entry per change (Hard Rule 2) | Frozen once released |
| [`../tasks/lessons.md`](../tasks/lessons.md) | One-sentence what-to-do-differently; links the postmortem that owns the story | Living |
| [`../tasks/`](../tasks/README.md) | In-flight plans and working ledgers for cross-session work | Living while the work is; deleted when it ships (the changelog keeps the record) or graduated to `decisions/` |
| Package READMEs | The per-package contract | Living |

Placement in one line: current behavior → `architecture/` or the package README; rationale and
trade-offs → `decisions/`; what shipped → `changelog/`; still broken → `issues/`; the story of how
it broke → `postmortem/`; the compressed warning → `tasks/lessons.md`; the plan for work still in
flight → `tasks/`.

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
