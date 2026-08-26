# Agent Note: A Trip is a server entity that owns a directory

Status: proposed

## Problem

travel-agent has no Trip. A conversation is the largest object the product knows, so nothing
outlives it: the four constraint chips (`web/src/features/chat/trip-constraints.ts`) are composed
into a text prefix, sent, and die with the message; a second conversation about the same journey
starts from zero; and there is nowhere for an itinerary or a booking artifact to live. `grep -E
"\btrip\b"` over `packages/server/src` returns only prose matches ("round trip"): the concept is
absent from the schema, not merely unexposed.

The consumer surface reflects the same absence. The sidebar's first-class objects are Project,
Agent and Workspace — a Workspace being a filesystem directory path — and its fixed navigation is
Agents / Models / Usage / Traces / Benchmark. That is the information architecture of the engine's
developer console, inherited from the PenguinHarness baseline. For an open-source consumer travel
application it names the wrong things: a traveller has trips, not workspaces.

Introducing a Trip forces one architectural question, because a travel agent's state is files —
an itinerary, later a booking record — and files live in a directory. If a Trip *is* a Workspace
directory, then a conversation's Trip membership is its `workspace`, and the engine fixes that at
Session creation:

- `SessionPatchRequest` (`server/src/api/types.ts:951`) carries `approvalMode`, `archived` and
  `title` only — `workspace` is create-only through the API.
- The value is recorded in the Trace's `session_meta` (`core/src/agent.ts:355`, `:518`) and read
  back on resume (`core/src/agent.ts:425`), and the Trace is append-only by explicit contract:
  "historical events are never modified in place" (`core/src/trace/writer.ts:8`).
- Memory scope is derived from the directory's real path,
  `basename-sha256(realpath)` (`core/src/state/memory.ts:140`). Changing the directory orphans the
  old scope silently — it is never deleted, only never read again.
- The workspace path is baked into the system prompt as the session's `cwd`
  (`core/src/internal/session-support.ts:47`), so re-pointing an ongoing conversation makes its own
  recorded history describe a directory it no longer uses.

Benchmarking Mindtrip makes membership mutability a product requirement rather than a nicety. Its
shipped model, verified first-hand (`docs/research/mindtrip.md` §13.4), offers "Move to trip" on a
floating chat and "Move to another trip" / "Remove from trip" inside one. Under a
Trip-is-the-Workspace mapping each of those is a workspace re-point, and therefore a change to
three separate invariants of a pinned engine.

## Proposal

A Trip is an entity in the server's own index, and it **owns** a directory rather than being one.

```
server index
  trips     tripId · projectId · name · destination · when · who · budget · dir · createdAt
  sessions  + trip_id (nullable)

disk  ~/Penguin Trips/<trip>/
  trip.json      identity fields, written by the server, read by the agent
  itinerary.md   the model's document

agent  reads and writes the trip directory by absolute path, taught by a trip skill
```

Membership is a nullable foreign key, so every mutation Mindtrip offers is one `UPDATE`: attach a
floating conversation, move it between trips, detach it back to floating. A conversation's
`workspace` is never touched, so none of the four constraints above is engaged.

This is safe because **the workspace is a default for relative paths, not a boundary**. The
file tools resolve with `path.resolve(ctx.workspaceDir, filePath)`
(`core/src/environment/tools/write-file.ts:86`, `read-file.ts:276`), which returns an absolute
`filePath` unchanged, and no confinement guard exists anywhere in `core/src/environment/tools/`.
`read-file.ts:308` documents the behaviour to the model in its own error text: "Absolute paths are
supported; relative paths resolve against the workspace." The trip directory therefore does not
need to be the conversation's workspace for the agent to work in it.

Placing the entity in `packages/server` follows the precedent already stated in the root
`AGENTS.md`: interaction cards are owned by `packages/server`. The server is where travel-agent's
own product concepts live, and this is an additive schema change — a new table, a nullable column,
new routes — not a modification of an existing engine invariant.

## What the model owns and what code owns

Code owns the identity fields it renders: the `trips` row and its `trip.json` mirror. The model
owns `itinerary.md` and anything else it writes into the directory. The model may *propose* an
identity change — this is how Mindtrip's chips behave, where a destination is inferred from prose
(§13.1) — but a proposal is rendered as an existing `selection` card and applied by the person's
click, never written by the agent directly. That keeps Hard Rule 4 intact: the model judges, code
enforces only where the model is inside the threat model.

Trip continuity likewise comes from the model, not from engine machinery: a trip skill has each
conversation read `trip.json` and `itinerary.md` before it starts work.

## Alternatives considered

- **Trip is a Workspace directory; membership is decided at draft time and never changes.**
  Rejected: it cannot represent a conversation that turns out to be a trip after several messages,
  which is the product's own entry shape — a person says one sentence before knowing what it
  becomes. Promotion would have to be "start a new conversation", discarding the exchange that
  produced the intent.
- **Trip is a Workspace directory; make `workspace` re-pointable (full mutability).** Rejected:
  it changes the append-only Trace contract, the memory-key derivation, and workspace immutability
  during a session, and it leaves one defect that cannot be repaired — the conversation's recorded
  history states a `cwd` that is no longer true. Three pinned-engine invariants is not a
  proportionate price for a foreign key.
- **Same, restricted to one-way promotion while idle.** Rejected: cheaper than full mutability
  (a temporary workspace has no memory by design — `core/src/state/memory.ts:163` — so nothing is
  orphaned in the scratch-to-trip direction), but it still amends `session_meta` in an append-only
  log, and the entity model delivers the same capability with no engine change at all.
- **Every conversation is born with its own directory; promotion writes `trip.json` into it.**
  Rejected: elegant — promotion becomes a file write and no path ever changes — but a directory
  created before the destination is known can only be named opaquely, and a conversation can never
  join an *existing* trip, which is the case the Mindtrip walkthrough actually exercised.
- **Trip is a Project.** Rejected: Project is a tenant and authorization boundary with roles,
  membership and per-Project agent configuration. Ten journeys would mean ten Projects, each
  reconfigured.
- **Trip is presentation-only, mapped onto Workspace groups with no server change.** Rejected: it
  was the first proposal in this discussion and it fails the same way as the first alternative —
  Workspace semantics (a directory path, fixed at creation) leak through every affordance that
  needs membership to change.

## Acceptance criteria

- A conversation can be created outside any trip, attached to a trip, moved to another trip, and
  detached, with no change to `packages/core` and no change to any Session's `workspace`.
- Trip identity fields survive across conversations of the same trip and are visible on each of
  them without being retyped.
- An agent working in a trip conversation reads and writes the trip directory by absolute path.
- The sidebar's first-class object is the Trip; engine console routes are reachable but demoted.
- Conversations with no trip remain usable and are not forced to become one.

## Risks

- **Two places hold identity.** The `trips` row and `trip.json` must not drift; the row is the
  writer and the file is a rendered mirror, refreshed on every identity change.
- **Per-workspace memory does not serve the trip.** Conversations in one trip may have different
  workspaces, so engine memory scope cannot carry trip continuity. The skill-read files replace it;
  if that proves too weak in use, the answer is a better trip document, not a workspace re-point.
- **The directory can be edited or moved by the person.** `trips.dir` can go stale. The trip must
  degrade honestly (show the missing directory) rather than recreate it silently.
- **An additive server schema is still a change to a pinned package.** It is deliberate, recorded
  here, and confined to travel-agent's own concepts — no upstream engine behaviour is altered.
