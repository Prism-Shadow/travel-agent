# Agent Note: Curated generated travel covers

Status: implemented — discovery cards use a bounded local decorative library with an explicit non-evidence boundary

## Problem

The draft screen and Trips overview need visual differentiation for inspiration, upcoming-trip,
and recent-session cards. A very small image set repeats visibly, but a live or scraped photo source introduces
availability, licensing, attribution, and provenance questions. A real-place photo also appears to
substantiate a specific hotel, restaurant, flight, attraction, or POI even when the card has no such
evidence.

## Decision

The web package owns a curated local catalog of 192 generated travel covers:

| Kind | Assets |
| --- | ---: |
| Destination | 96 |
| Activity | 48 |
| Season/weather | 24 |
| Location-neutral fallback | 24 |

The 48 original assets retain generation recipe version 1 and the 144 expansion assets use version
2. Runtime copies are 960×720 progressive sRGB JPEGs with EXIF, ICC, and XMP metadata removed. The
complete catalog is 22.93 MiB, averages 122.30 KiB per image, and has a 250 KiB per-file ceiling and
a 32 MiB total ceiling.

Generated covers are decorative fallback imagery. They carry empty alternative text and never
serve as evidence for a place, offer, availability claim, or booking decision. A sourced browser
screenshot or sourced POI image takes priority if a future surface has one.

Selection uses the card's Session id and title without a model call. Explicit activity intent has
precedence over a named destination, which has precedence over seasonal mood. A title with no known
intent draws only from the neutral fallback group. Selection is deterministic for the same
ordered subjects and exclusions. A selection pass prefers unused eligible covers, then unused
neutral fallbacks. Once these finite candidates are exhausted, eligible covers may repeat;
unrelated destinations never become eligible merely to make a long list unique.

The overview selects once over dated, unscheduled and past trips in render order, with Trip ids
as subject ids and nonblank names (or destinations) as titles. Collapsed history reserves its
covers, so expanding it does not alter another card. Independent surfaces may give a Trip a
different decorative cover. Persisting cover identity or unifying unrelated presentation orders
would add state for a property that is not part of the Trip's identity.

The overview's empty state uses a separate generated coastal background at
`packages/web/public/trips/empty-background.webp` (1586×992, 63,714 bytes). It is outside the 192-cover
catalog and its byte budget. The left side leaves space for live localized text and the New trip
action; the anonymous coast is atmosphere, not an example record or destination recommendation.

The repository stores optimized runtime JPEGs and catalog metadata. Generation masters stay
outside the repository. The four 36-image batch commits retain the prompt matrix, ImageGen output
identifiers, checksums, and accept/rework ledger after the completed task files leave `tasks/`. The
runtime type does not carry `region`, `generationBatch`, or `checksum` fields because selection does
not consume them and git history already owns that provenance.

## Alternatives considered

- **Scrape Google Places, travel sites, or search results into a permanent local library.** This
  loses on licensing, provenance, staleness, and the risk that a decorative card implies factual
  support for the exact POI.
- **Fetch live third-party photos for every card.** This adds credentials, attribution UI, network
  failure states, and tracking to a surface that needs only a decorative fallback. It remains a
  separate future capability for sourced POI evidence, not a replacement for this catalog.
- **Generate a cover at runtime for each Session.** This adds latency, model cost, nondeterminism,
  and a new failure path before the person's own work can be shown.
- **Keep the 48-image catalog.** It meets the technical contract but repeats subjects and palettes
  too often across destination, activity, and seasonal intents.
- **Add review-only provenance fields to every runtime entry.** This bloats the shipped selection
  API without improving selection or enforcement; batch records and git history retain that data.

## Consequences

- The packaged application carries 22.93 MiB of cover imagery, bounded by automated file and total
  size checks.
- Adding or replacing a cover requires catalog/file parity, stable selection metadata, full-size and
  card-crop visual review, and duplicate review against the complete library.
- Generated imagery communicates a broad travel mood, not exact-place truth. Product surfaces must
  not reuse it where a person could interpret the image as booking evidence.
- Cards lazy-load the selected static files and decode them asynchronously; the other catalog files
  are not imported into the JavaScript bundle.

## Testing

The web contract test pins 192 unique ids and paths, exact 96/48/24/24 kind totals, prompt-version
totals, manifest/file parity, progressive 960×720 three-component JPEG frames, stripped metadata,
and per-file, average, and total byte budgets. Semantic fixtures cover English and Chinese
destination, activity, seasonal, accessible-travel, and unknown-title selection. A 64-bit
difference-hash comparison covers all 18,336 unique pairs; no pair is at or below the manual-review
threshold of eight bits, and the nearest eight pairs pass visual review.

All 144 version-2 assets passed full-resolution and card-crop visual review. Eight assets were
reworked before acceptance for pseudo-text, face-like artifacts, repeated composition, or readable
labels. Responsive QA covers both discovery-rail states, all carousel positions, English, Chinese,
and mixed-language titles, sidebar states, and narrow and wide Desktop Browser layouts. Runtime
requests fetch only the selected visible covers rather than the complete catalog.
