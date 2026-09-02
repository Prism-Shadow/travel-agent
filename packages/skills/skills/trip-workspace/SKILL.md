---
name: trip-workspace
description: Read and maintain the files of the Trip a conversation belongs to. A Trip is the traveller's journey - it owns a folder on their own disk holding trip.json (its identity, written by the app) and itinerary.md (the plan, written by you). Use at the start of any conversation that belongs to a Trip, and whenever a decision, a comparison or a booking-page result should outlive the conversation that produced it.
short_description: Work in the trip folder - read what the journey knows, write what you decide.
short_description_zh: 在行程文件夹中工作——读取行程已知信息，写回你的决定。
version: 2
updated: 2026-08-28T00:00:00Z
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
| `trip.json` | **The app**, except a blank destination | Destination, dates, travellers, budget tier. Read it. Write only the one case below. |
| `itinerary.md` | **You** | The plan: what happens on which day, and why. |
| `places.json` | **You** | Coordinates of the places in the plan (optional; see below). |
| `map.png` | **You** | A rendered map of those places (optional; see below). |

`trip.json` is written by the application when the person edits the trip's chips. If a detail is
**wrong**, say so and let them correct it — overwriting their answer would put the app and the
folder out of step, and they know where they are going better than you do.

### The one field you may write: an empty destination

A Trip is created by the first message, and its identity comes from those chips. Someone who
writes "I'm going to Shanghai tomorrow" and never fills the chips gets a trip called *Untitled
trip* — the destination was in the sentence, and only the form was listened to. You read that
sentence. You can fix it.

When `destination` in `trip.json` is empty **and the conversation has made the destination
unambiguous**, write the file back with `destination` filled in, keeping every other field exactly
as it was. The app adopts it the next time it reads the trip, and renames the folder's trip if it
is still called *Untitled trip*.

The rule the app enforces, so you can rely on it: **a blank may be filled, a value is never
overwritten.** Your write cannot damage an answer the person gave. That is also why this is the
only field — dates, party size and budget are commitments they make, not observations you can
read off a sentence.

Do not guess. "Somewhere warm in March" is not a destination; Shanghai is. If the conversation has
not settled it, leave the file alone and ask.

## Reading trip.json

```json
{
  "version": 2,
  "tripId": "t-1a2b3c4d",
  "name": "Tokyo in October",
  "destination": "Tokyo",
  "when": { "kind": "flexible", "days": 5, "months": ["2026-10", "2026-11"] },
  "who": { "adults": 2, "children": 0, "infants": 0, "pets": 0 },
  "budget": "mid",
  "budgetAmount": 20000,
  "budgetCurrency": "CNY",
  "createdAt": "2026-08-26T09:00:00.000Z",
  "updatedAt": "2026-08-26T09:00:00.000Z"
}
```

- `when` is either `{"kind":"dates","start","end"}` (either end may be `""`) or
  `{"kind":"flexible","days","months"}` — `months` is a list of `YYYY-MM` entries and empty means
  any month. Flexible dates are a licence to compare across days and months when that finds a
  better option — use it.
- `who.pets` changes what qualifies, not the price bracket: a stay that does not take animals is
  not an option at all.
- `budget` is a tier (`any`, `low`, `mid`, `high`, `luxury`): the shape of what to propose.
- `budgetAmount`, when present, is the whole-trip total the person stated, in `budgetCurrency`
  (an ISO 4217 code; the two are always present together). Use it for arithmetic — what a
  flight leaves for hotels, whether an option fits at all. Prices on a site are often in another
  currency: convert with the rate you know, say which rate you used, and never present a
  converted figure as the site's own. A `version: 1` file carries `budgetAmountCny` instead,
  which means the same amount in CNY. Neither field is authority to spend; the stop at the
  payment page is unconditional.
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

## Spatial claims: show, do not assert

When the plan depends on where something is — "this hotel is close to the station", "these two
are walkable" — a claim in prose is something the person has to take on trust. A map is the
evidence for it.

This is worth doing when a spatial fact is actually load-bearing (choosing between hotels by
location, checking a day's stops are near each other). It is not worth doing for decoration.

1. **Geocode** the places with the `amap-lbs-skill` (mainland China; it needs the user's
   `AMAP_KEY` from the vault). Record what you found:

   ```json
   {
     "version": 1,
     "places": [
       { "name": "Shinjuku Station", "lng": 139.7005, "lat": 35.6909, "note": "nearest station" }
     ]
   }
   ```

2. **Render** a static map to `map.png` in the trip folder, using the same Web Service key:

   ```bash
   curl -s -o "<trip folder>/map.png" \
     "https://restapi.amap.com/v3/staticmap?size=750*400&zoom=13&markers=mid,,A:139.7005,35.6909&key=$AMAP_KEY"
   ```

   The key stays in your environment and in the request. It must never be written into
   `itinerary.md`, `places.json`, or any file in the folder.

3. **Reference it from the plan**, with the fact beside it:

   ```markdown
   ![Hotel and station](map.png)

   Hotel Celestine is 400 m from Ginza station — about a 5 minute walk.
   ```

   Relative image names in `itinerary.md` resolve to the trip's own folder, so the map appears
   inline on the trip page.

**Coverage, honestly.** Amap covers mainland China well and other countries poorly. Outside the
mainland, do not produce a map that would be wrong or empty — state the distance you found and
its source instead. A missing map is better than a misleading one.

## What this skill does not do

- It does not create or delete Trips. The person does that in the app.
- It does not write `trip.json`, except to fill in a destination that is blank — see above.
- It does not decide dates, party size or budget. Those are the person's commitments.
- It does not delete anything in the trip folder. Those files are the person's.
- It does not keep a booking ledger. This product stops at the payment page and cannot see whether
  the payment went through; a file claiming a booking exists would be a guess.
