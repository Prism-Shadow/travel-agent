# Postmortems

The full story of an incident that cost real time — the only home for war-story narrative. A
postmortem exists so the next agent does not pay the same price twice: `tasks/lessons.md` keeps
the one-sentence warning and links here; the postmortem keeps the evidence and the chain of
reasoning.

## When to write one

- Closing a `docs/issues/` entry whose failure was expensive to find or fix.
- Any incident where the interesting part is *why every gate missed it* — that narrative fits
  neither a commit message nor a one-line lesson.

Skip it when the fix is its own explanation; not every closed issue earns a story.

## Naming and format

`NNNN-slug.md`, numbered in landing order. Frozen once landed — a postmortem is a dated record.

```markdown
# NNNN — <title>

## What happened
## Why nothing caught it
## What changed
## Links
```

`## Links` names the issue it closes, the fixing change, the lesson that compresses it, and any
related decision notes.
