# 006 · Generated travel cover library

Status: implemented (phase 1, 2026-08-19)

## Purpose and trust boundary

The welcome screen needs image-first cards, but this product does not own a POI photo
catalog. Phase 1 therefore ships a curated library of 48 original generated photographs for
decorative covers only. They improve recognition and warmth without claiming to show the
exact hotel, room, restaurant, flight, or attraction discussed in a Session.

Cover precedence remains:

1. a safe screenshot from the Session's real browser evidence layer (future P2 integration);
2. a sourced POI image whose provenance is retained (future search-result integration);
3. a semantic match from this generated catalog;
4. one of four location-neutral generated fallbacks.

## Catalog

`packages/web/src/lib/travel-cover-library.ts` is the manifest and selection API. Every item
contains its stable id/path, kind, short subject, tags, multilingual matching keywords,
season, tone, crop focal point, source, and prompt version.

- 24 destination scenes
- 12 activity scenes
- 8 season/weather scenes
- 4 generic fallback scenes

All browser assets live in `packages/web/public/travel-covers/` as 960×720 JPEG files. The
catalog deliberately excludes remotely loaded images so desktop startup and offline welcome
screens remain deterministic.

## Selection behavior

`selectTravelCovers()` scores normalized Session title/intent text against the catalog's
English and Chinese keyword phrases. Explicit activity intent ranks first, then a named
destination, then seasonal atmosphere. With no match, only the neutral fallback group is
eligible; an unrelated Session is never decorated with a guessed city. A stable Session-id
hash resolves ties, while already used covers move to the back to avoid adjacent duplicates
in the visible rail.

Generated assets are presentation, not evidence: their `<img>` elements have empty alt text,
while the Session title remains the accessible button label.

## Generation prompt set

Built-in ImageGen was called once per individual asset with this shared art direction:

> Use case: photorealistic-natural. Asset type: full-bleed travel conversation card cover.
> Original premium editorial travel photography with realistic natural textures. Landscape
> 4:3; strongest subject in the middle and upper half; quieter lower third reserved for white
> UI copy. No readable text, logos, watermark, frame, UI, close-up faces, or reproduced art.

Each catalog entry's `subject` was supplied as the individual scene request (for example
“Tokyo at blue hour”, “scenic train journey”, or “packed suitcase by a window”).
`promptVersion: 1` records this generation recipe so a future refresh can be audited and
rolled out without changing matching semantics.

## Quality and packaging

Generated masters remain outside the repository in the ImageGen output store. The committed
runtime copies are resized and JPEG-compressed for the card's actual rendered dimensions.
Tests enforce the 48-item count, unique ids/paths, semantic matching, neutral fallback,
deduplication, stability, and on-disk file presence.
