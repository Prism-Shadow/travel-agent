# The agent may fill a blank destination, and may never overwrite one

**Status:** implemented · 2026-08-28

## The problem

A Trip is materialized by the first message, and its identity comes from the chips above the
composer. Someone who writes

> I'm going to Shanghai on a business trip tomorrow

and never touches the chips gets a Trip called *Untitled trip*, in a folder named for a date. That
is what happened on 2026-08-27: `t-790ab97a`, destination empty, while the whole conversation was
about Shanghai.

The product's claim is that one sentence is enough. Trip naming listened only to the form.

The model that read the sentence knew the answer the entire time. It had no way to say so: the
agent has no trip tool, `trip.json` was documented as *read it, never write it*, and the row in the
database was the only writer.

## What was decided

The agent may write `trip.json`. The server reconciles it wherever a Trip is already read
(`list`, `get`), under one rule:

> **A blank may be filled. A value is never overwritten.**

Only `destination`, plus the `name` that defaults from it — and the name only while it is still the
`Untitled trip` placeholder, exactly as an explicit name beats a destination at creation time.

## Why this shape

**Why not a second model call before sending?** That is the same judgement the main model is about
to make anyway, run twice, on the latency-critical path, seeing only the first sentence. It also
cannot correct itself later when the person says "actually, Suzhou".

**Why not a tool?** Tools are registered in `packages/core`, a pinned engine snapshot (Hard Rule 3).
Adding one would be an engine change to serve a product feature. The agent already has file tools,
and the Trip already has a file.

**Why reconcile on read rather than watch?** A watcher is a long-lived process, which this product
does not have by design. Reading a mirror at the moment something already reads the Trip costs one
`readFile` on a path already being stat-ed for `dirExists`.

**Why only the destination?** Dates, party size and budget are commitments the person makes, not
observations available in a sentence. A model writing those would be authoring intent rather than
recording it. The destination is different: when someone says they are going to Shanghai tomorrow,
the destination is a fact of the sentence.

## What this gives up

The mirror is no longer purely derived, so the two can disagree between a write and the next read.
The one-directional rule bounds the damage: the disagreement can only ever be *the agent knows a
destination and the row does not*, which is exactly the state being repaired.

A model that misreads a sentence can now put a wrong destination on a Trip that had none. It cannot
touch one the person filled in, and the chips remain editable. That was judged better than the
current behaviour, where a Trip the person described in words stays *Untitled trip* forever.

## Enforcement

The rule is server-side, in `TripService.adoptAgentIdentity`, not in the skill — the skill states
it so the model can rely on it, but a model that ignores the instruction still cannot overwrite
anything. `packages/server/test/trips.test.ts` pins all four cases: the blank is filled, a person's
destination stands, a person's name survives an adopted destination, and a malformed mirror is
ignored.
