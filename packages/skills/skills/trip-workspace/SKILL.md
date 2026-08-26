---
name: trip-workspace
description: Read and maintain the files of the Trip a conversation belongs to. A Trip is the traveller's journey - it owns a folder on their own disk holding trip.json (its identity, written by the app) and itinerary.md (the plan, written by you). Use at the start of any conversation that belongs to a Trip, and whenever a decision, a comparison or a booking-page result should outlive the conversation that produced it.
short_description: Work in the trip folder - read what the journey knows, write what you decide.
short_description_zh: 在行程文件夹中工作——读取行程已知信息，写回你的决定。
version: 1
updated: 2026-08-26T00:00:00Z
---

# Trip workspace

A **Trip** is the traveller's journey. It owns a folder on their own disk, and that folder — not
this conversation — is where the journey's state lives. Conversations come and go; several may
belong to the same Trip. Anything worth knowing next time goes in the folder.

The folder is the person's property. They can open it in a file manager, back it up, and keep it
after uninstalling this application. Write it as something a human will read.

## Before you start

The app tells you the trip folder's absolute path when a conversation belongs to a Trip. If no
path was given, this conversation belongs to no Trip: work normally and do not invent a folder.

Read these two first, in this order:

```bash
cat "<trip folder>/trip.json"      # the journey's identity - who, where, when, budget
cat "<trip folder>/itinerary.md"   # the plan so far (may not exist yet)
```

Use absolute paths for everything in the trip folder. Your working directory is somewhere else
and is not the trip.

## What each file is, and who owns it

| File | Owner | Meaning |
| --- | --- | --- |
| `trip.json` | **The app** | Destination, dates, travellers, budget tier. Read it; never write it. |
| `itinerary.md` | **You** | The plan: what happens on which day, and why. |

`trip.json` is written by the application when the person edits the trip's chips. If the journey's
details are wrong or missing, say so and let them correct it — editing the file yourself would be
overwritten and would put the app and the folder out of step.

## Reading trip.json

```json
{
  "version": 1,
  "tripId": "t-1a2b3c4d",
  "name": "Tokyo in October",
  "destination": "Tokyo",
  "when": { "kind": "flexible", "days": 5, "month": "2026-10" },
  "who": { "adults": 2, "children": 0, "infants": 0 },
  "budget": "mid",
  "createdAt": "2026-08-26T09:00:00.000Z",
  "updatedAt": "2026-08-26T09:00:00.000Z"
}
```

- `when` is either `{"kind":"dates","start","end"}` (either end may be `""`) or
  `{"kind":"flexible","days","month"}`. Flexible dates are a licence to compare across days when
  that finds a better option — use it.
- `budget` is a tier (`any`, `low`, `mid`, `high`, `luxury`), never a number. Treat it as the
  shape of what to propose, never as authority to spend.
- A field may be `null` or `""`: that means the person has not said. Ask, or proceed and tell them
  what you assumed. Do not fabricate dates or traveller counts.

## Writing itinerary.md

Keep it a document a person would want to read on the trip, not a log of what you did.

```markdown
# Tokyo, 5 days in October

2 adults · mid-range · staying near a subway line (their words)

## Day 1 — arrival
- NRT → Shinjuku by airport bus, ~90 min
- Evening: Omoide Yokocho for dinner

## Day 2
- Meiji Jingu → Harajuku → Shibuya
- Note: the museum is closed on Tuesdays, so this day moved

## Open questions
- Return flight not booked yet
```

Rules that make it worth keeping:

- **Record the reason, not just the choice.** "Shinjuku, because everything they picked is on the
  Marunouchi line" is useful in the next conversation; "Shinjuku" is not.
- **Write preferences down when you learn them.** A sentence like "they want to be near a station"
  is exactly what the next conversation cannot otherwise know.
- **Update in place.** Re-read the file, change the part that changed, keep the rest. Do not
  append a second copy of the plan, and do not rewrite the person's own edits away.
- **Keep what is not settled visible.** An "Open questions" section is more honest than silence.

## When to write

Write to the trip folder when something happened that should outlive this conversation:

- a decision was made (which hotel area, which airport, which day to move);
- a comparison produced a reason worth keeping ("Fliggy was cheaper but excludes the tax");
- the person stated a preference or a constraint;
- you reached a payment page and stopped there — record what was prepared and what is left to do,
  so the next conversation knows where things stand.

Do not write after every message. A conversation that only answered a question changes nothing
about the journey.

## What this skill does not do

- It does not create, rename or delete Trips. The person does that in the app.
- It does not write `trip.json`.
- It does not delete anything in the trip folder. Those files are the person's.
- It does not keep a booking ledger. This product stops at the payment page and cannot see whether
  the payment went through; a file claiming a booking exists would be a guess.
