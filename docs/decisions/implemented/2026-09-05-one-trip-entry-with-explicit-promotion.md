# Agent Note: One Trip entry, with explicit conversation promotion

Status: implemented

## Problem

New chat and New trip open the same composer but promise different objects on the first send.
The traveller must decide whether a question is a journey before discussing it. A journey also
needs several conversations without repeating its identity or merging their transcripts.

## Decision

New trip is the single global start. It creates a draft, and its first send creates an independent
conversation. The person chooses Add to trip when ready, creates a named Trip or selects an
existing one, and continues the same conversation. Trip pages, conversation headers and sidebar
Trip actions offer New chat inside that Trip. Both starts share the same welcome heading,
composer, starter-card treatment and responsive discovery rail. Trip-bound starts name their
inherited Trip and use relevant prompts in those shared cards. Models remains top-level
navigation beside My Trips.

The existing nullable membership column serves this flow. Attaching does not move a workspace,
rewrite a trace, copy messages or migrate artifacts. Files created before attachment stay where
they are and remain accessible from the originating conversation. The UI states this in the
attachment dialog. Files the model subsequently creates for the Trip belong in its directory.

User-maintained shared notes extend Trip identity in the server's product layer: an additive
SQLite text column, DTO field and trip.json mirror. Existing rows read with empty notes. The
model owns the itinerary, not these notes; its blank-destination adoption cannot adopt notes.
There is no new tool, dependency or change to the pinned core runtime.

The Web send path resolves membership and current identity before a message, including queued
follow-ups and steering. Shared context is visible in the outgoing text: Trip name, directory,
stated constraints and notes. A queued message retains the snapshot from when it was queued.
Topic starts and explicit model/agent forks retain Trip membership and receive shared context,
while their histories remain separate. Notes are maintained by the person rather than inferred
by a client rule or copied indiscriminately from another transcript.

## Alternatives considered

- **Keep both start entries.** Rejected because the same composer asks for an early classification
  that the ensuing conversation is supposed to help the person make.
- **Create a Trip on every first message.** Rejected because ordinary travel questions remain
  useful independent conversations and need no journey directory.
- **Model-proposed creation in this iteration.** Deferred: interaction cards return choices to the
  agent but do not execute Trip API commands. Matching prose to guess a command would violate
  the model/code boundary. A visible Add to trip action closes the current user flow.
- **Treat the Trip as the workspace or automatically move existing files.** Rejected because
  workspace identity and trace paths are stable. The entity/membership decision already gives
  the needed behavior without moving user artifacts.

## Consequences

A global start is independent even when opened from a Trip. Drafts persist their explicit Trip
scope through parking and reload. An unavailable topic target fails visibly before Session
creation; it never silently becomes a loose conversation.

Create and attach reuse the existing APIs. After a confirmed creation, an attachment failure
keeps that Trip selected for retry instead of creating another one. Closing the dialog leaves
the created Trip visible and the conversation independent. The operation is not an atomic API
transaction or an exactly-once guarantee for lost network responses.

The coastal empty state belongs to My Trips. The chat start keeps the existing travel collage,
composer controls and discovery rail. This is one chat route, with welcome and conversation
states, rather than an additional landing page.

## Testing

Server tests cover notes persistence, editing, clearing, validation, mirroring and database
upgrades. Web tests cover context composition and draft scope. Browser tests exercise global
start, promotion preserving history/workspace, existing-Trip attachment, failed-attach retry,
separate topics and shared-note changes. Model arbitration and automatic artifact relocation
are not established by these tests and are not part of this change.
