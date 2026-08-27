# Agent Notes

An Agent Note records a decision that shapes this codebase — the why and what was given up, the
parts that neither the code nor the spec that describes it can carry. A spec states what is true; a
commit states what changed; a note is written **in addition** when a change decides something a
maintainer could reasonably revisit: an architecture boundary, a contract, a default, a process,
the rejection of an obvious alternative.

## Layout and naming

`{lifecycle}/yyyy-mm-dd-topic.md` — the date is when the topic was first proposed, per git
history. No class subfolders and no `INDEX.md`: at this repo's volume, the tree plus search is the
index. Cross-reference notes with relative markdown links so references survive lifecycle moves.

- **`proposed/`** — reviewed before implementation; not yet built, or only partly.
- **`implemented/`** — the decision shipped. Facts (paths, names, defaults) are kept current in
  the same change that alters them; the decision itself is never edited into a different decision.
  To reverse it, write a new note and cross-link both.
- **`rejected/`** — considered and declined. Keep only while the rationale prevents a tempting
  mistake; otherwise delete the file.
- `archived/` does not exist yet; introduce it when maintaining implemented notes becomes a
  measurable burden.

## Format

The first three lines of every note, exactly:

```markdown
# Agent Note: <title>

Status: <proposed | implemented | rejected — why, in one line>
```

The body opens with `## Problem`, written to stand without the solution. Then, by lifecycle:

- `proposed/`: `## Proposal` … bespoke sections … `## Alternatives considered`,
  `## Acceptance criteria`, `## Risks`. Future tense is legitimate here.
- `implemented/`: `## Decision` … bespoke sections … `## Alternatives considered`,
  `## Consequences`. Present tense throughout; no "should", no migration plans, no acceptance
  checklists — that is spec-speak for something that already exists. A `## Testing` or
  `## Deferred` section is fine where it states present-tense fact.
- `rejected/`: the proposal frozen as it was; the verdict lives on the `Status:` line.

**`## Alternatives considered` is mandatory in every note** — each genuine alternative and why it
lost. A decision recorded without what it beat invites re-litigation. Alternatives are recorded,
never invented after the fact.

## Lifecycle moves

- `proposed/` → `implemented/`: update `Status:`, rewrite `## Proposal` into a present-tense
  `## Decision`, fold acceptance criteria and risks into `## Consequences` or a `## Testing`
  section stating what now pins the behavior, and drop plans in favor of what shipped.
- `proposed/` → `rejected/`: add the reason to the `Status:` line and freeze the file.
