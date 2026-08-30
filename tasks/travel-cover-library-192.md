# Travel cover library expansion: 48 → 192

Status: in progress; Batches A–B accepted (120 of 192 total assets delivered)

## Goal

Expand the existing generated travel-cover library from 48 to 192 production-ready assets
without changing its trust boundary: generated covers are decorative fallbacks, not evidence of
the exact hotel, restaurant, flight, attraction, or POI discussed in a Session.

This project adds 144 assets. The existing 48 remain the Phase 1 baseline unless visual QA finds a
specific asset that must be replaced. Google Places or other third-party images must not be scraped,
downloaded into this library, or committed to the repository.

## Target inventory

| Kind | Current | Target | Add | Coverage target |
| --- | ---: | ---: | ---: | --- |
| Destination | 24 | 96 | 72 | Multiple regions, seasons, times of day, and urban/nature compositions |
| Activity | 12 | 48 | 36 | Transport, food, culture, outdoors, relaxation, and travel-party intent |
| Season/weather | 8 | 24 | 16 | Balanced spring, summer, autumn, winter, and common weather moods |
| Generic fallback | 4 | 24 | 20 | Location-neutral planning, transit, luggage, arrival, and travel-tool scenes |
| **Total** | **48** | **192** | **144** | |

Destination coverage should be audited against these final regional targets before prompts are
locked: East Asia 18, Southeast Asia 12, South Asia and Middle East 8, Europe 24, North America 14,
Latin America 8, Africa 6, and Oceania 6. These are catalog totals, including the current 24 assets.

Activity coverage should end with eight assets in each of six intent groups: transport, food,
culture/city, outdoor adventure, lodging/relaxation, and travel party/occasion.

Generic covers must remain genuinely location-neutral. They must not contain recognizable
landmarks, readable tickets, brand marks, country flags, or text that implies a destination.

## Batch plan

Generate and review four independent batches. Each batch adds exactly 36 assets: 18 destination,
9 activity, 4 season/weather, and 5 generic.

### Batch A — Asia and Oceania

- [x] Add 18 destination scenes covering East, Southeast, and South Asia plus Oceania gaps.
- [x] Add 9 activity scenes with emphasis on rail, markets, food, wellness, and family travel.
- [x] Add 4 season/weather scenes that are not tied to a recognizable POI.
- [x] Add 5 generic planning/transit fallback scenes.
- [ ] Complete metadata, technical validation, visual QA, selection tests, and responsive UI QA.

### Batch B — Europe

- [x] Add 18 destination scenes covering major cities and less repetitive coast, alpine, rural,
      island, and northern compositions.
- [x] Add 9 activity scenes with emphasis on museums, cafés, walking, rail, skiing, and road trips.
- [x] Add 4 season/weather scenes that differ materially from Batch A.
- [x] Add 5 generic luggage/arrival fallback scenes.
- [ ] Complete metadata, technical validation, visual QA, selection tests, and responsive UI QA.

### Batch C — North and Latin America

- [ ] Add 18 destination scenes across North America, Central America, South America, and the
      Caribbean without over-concentrating on skyline imagery.
- [ ] Add 9 activity scenes with emphasis on national parks, food, beaches, music, family travel,
      and self-drive itineraries.
- [ ] Add 4 season/weather scenes that differ materially from Batches A and B.
- [ ] Add 5 generic travel-tool and in-transit fallback scenes.
- [ ] Complete metadata, technical validation, visual QA, selection tests, and responsive UI QA.

### Batch D — Africa, Middle East, and gap fill

- [ ] Add 18 destination scenes across Africa and the Middle East, then use remaining slots to fill
      coverage gaps identified after Batches A–C.
- [ ] Add 9 activity scenes needed to bring every activity intent group to eight assets.
- [ ] Add 4 season/weather scenes needed to reach balanced final coverage.
- [ ] Add 5 generic scenes needed to reach 24 neutral fallbacks.
- [ ] Complete metadata, technical validation, visual QA, selection tests, and responsive UI QA.

## Preparation before generation

- [ ] Export an inventory of the current 48 ids, subjects, kinds, regions, seasons, tones, keywords,
      and crop focal points; mark semantic and visual coverage gaps.
- [x] Define all 144 new stable ids before generating images so filenames and catalog entries cannot
      drift between batches.
- [x] Create a prompt matrix containing subject, region, composition, season/weather, time of day,
      activity intent, prohibited elements, and desired crop focal point for every asset.
- [ ] Ensure every popular destination or intent represented on the welcome screen will have at
      least three materially different candidates after expansion.
- [ ] Review whether `TravelCoverAsset` should gain explicit `region`, `generationBatch`, and
      `checksum` metadata. Add fields only if they improve validation or future maintenance.
- [x] Version the new shared generation recipe as `promptVersion: 2`; keep existing assets at their
      recorded version unless regenerated.
- [x] Add an inventory review checkpoint before each ImageGen batch. No batch starts until its ids,
      prompts, category totals, and duplicate-risk notes are approved.

## Generation specification

- [ ] Generate one original image per catalog id; do not create crops as separate catalog entries.
- [ ] Preserve the current premium editorial, photorealistic-natural direction and 4:3 landscape
      composition, with the strongest subject in the middle/upper area and a quieter lower third.
- [ ] Prohibit readable text, logos, watermarks, UI, flags used as labels, close-up identifiable
      faces, copied artwork, and misleading depictions of a specific real POI.
- [ ] Keep generation masters outside the repository and record their output identifiers alongside
      prompt version and catalog id in the batch review notes.
- [ ] Produce runtime copies at 960×720 in sRGB JPEG, stripped of EXIF and other unnecessary metadata.
- [ ] Target an average runtime size of at most 160 KiB, a per-file maximum of 250 KiB, and a total
      192-asset runtime footprint of at most 32 MiB.

## Visual QA for every asset

- [ ] Reject anatomical errors, duplicated objects, impossible reflections, broken architecture,
      warped vehicles, illegible pseudo-text, accidental logos, watermarks, and visible generation
      artifacts.
- [ ] Reject images that are near-duplicates of an existing cover in subject, palette, composition,
      and season; a new filename alone does not count as diversity.
- [ ] Verify that white card titles remain readable over the lower gradient at all supported card
      sizes and that `objectPosition` preserves the principal subject.
- [ ] Verify that destination covers communicate a broad destination mood without pretending to be
      evidence of the exact place discussed by the user.
- [ ] Review cultural details for obvious inaccuracies or stereotypes before accepting an asset.
- [ ] Record accept/reject/rework status and a short reason in the batch review.

## Catalog and selection work

- [ ] Add accepted assets to `packages/web/public/travel-covers/` and
      `packages/web/src/lib/travel-cover-library.ts` in their completed batch only.
- [ ] Provide every asset with stable id/path, kind, subject, tags, English and Chinese keywords,
      seasons, tone, crop focal point, source, and prompt version.
- [ ] Preserve selection precedence: explicit activity intent, named destination, seasonal mood,
      then location-neutral generic fallback.
- [ ] Preserve deterministic selection for the same Session id and title.
- [ ] Preserve same-screen exclusion between Jump back in and Get inspired.
- [ ] Add a bounded recent-cover cooldown only if repetition remains visible after the expanded
      candidate pools are tested; do not introduce persistent state without measured need.
- [ ] Keep generated images decorative (`alt=""`) and keep the Session/card title as the accessible
      name.

## Automated verification

- [ ] Update the catalog contract test from 48 to 192 and assert exact kind totals of 96/48/24/24.
- [ ] Assert one-to-one manifest/file parity, unique ids, unique paths, valid source metadata, and no
      missing files or orphaned assets.
- [ ] Add automated checks for 960×720 dimensions, 4:3 aspect ratio, file-size budget, sRGB output,
      and removed metadata.
- [ ] Add a duplicate report using perceptual hashes; manually review every pair below the selected
      distance threshold instead of automatically deleting assets.
- [ ] Expand semantic fixtures to at least 30 representative English/Chinese titles covering
      destinations, activities, seasons, and generic non-travel conversations.
- [ ] Verify unknown or non-travel titles still select only generic assets.
- [ ] Verify exclusions, stability, and no duplicate covers across both simultaneously visible rails.
- [ ] Run Web tests, Web typecheck, production build, format check, and `git diff --check` after each
      batch.

## UI and packaging verification

- [ ] Capture the welcome screen with sidebar expanded and collapsed.
- [ ] Capture desktop split layouts with the Browser hidden and visible at narrow and wide widths.
- [ ] Check Jump back in and Get inspired at the first, middle, and last carousel positions.
- [ ] Check title readability for short English, long English, Chinese, and mixed-language titles.
- [ ] Confirm images are lazy-loaded and only visible/near-visible cards request their assets.
- [ ] Compare packaged application size and welcome-screen render performance against the 48-asset
      baseline; remain within the 32 MiB library budget.

## Rollout and commits

- [ ] Keep each 36-image batch in its own reviewable commit with its manifest and tests.
- [ ] Do not mix Browser/Core/Desktop work or unrelated documentation into these commits.
- [ ] Record the actual counts, prompt version, footprint, and QA results of each accepted batch
      in a `docs/decisions/` note for the cover library.
- [ ] After Batch D, run the repository's full blocking CI before merging or pushing the completed
      192-asset library.
- [ ] Preserve rollback by ensuring removal of one batch restores the previous valid catalog count
      without changing selection semantics.

## Definition of done

- [ ] Exactly 192 manifest entries and 192 runtime files exist.
- [ ] Final kind totals are exactly 96 destination, 48 activity, 24 season/weather, and 24 generic.
- [ ] Every asset passes metadata, dimensions, size, visual, cultural, and duplicate review.
- [ ] Popular destinations and activities have at least three materially different candidates.
- [ ] Jump back in and Get inspired do not display the same cover at the same time.
- [ ] Generic/non-travel Sessions are never decorated with a guessed destination.
- [ ] The complete library is at most 32 MiB and introduces no eager loading regression.
- [ ] Full blocking CI passes and the final design document records the delivered inventory.

## Out of scope

- Scraping Google Maps, Google Places, Mindtrip, or another service into a permanent local library.
- Treating generated covers as POI evidence or using them in booking/checkout decisions.
- Implementing live Google Place Photos, sourced DMO imagery, or Session screenshot precedence.
- Generating any of the 144 new assets as part of this planning task.

## Review

- Batch A adds 36 accepted prompt-version-2 assets and brings the runtime catalog to 84. Its exact
  ImageGen outputs, checksums, technical results, and rework history are recorded in
  `tasks/travel-cover-library-192-batch-review.md`.
- Batch B adds 36 accepted prompt-version-2 assets and brings the runtime catalog to 120. Its
  European destination, activity, season, and generic scenes pass the same technical and visual
  review contract.
- The locked prompt matrix reaches 192 through three remaining 36-asset batches, keeping cost,
  review, rollback, and CI failures bounded to one batch at a time.
