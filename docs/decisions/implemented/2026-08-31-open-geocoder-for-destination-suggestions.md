# Agent Note: Use a replaceable open geocoder for destination suggestions

Status: implemented — Where suggests real places without introducing a proprietary POI catalog

## Problem

The Where dialog accepted only free text. It could not distinguish London in England from London
in Ontario, correct a partial place name, or offer the five compact candidates that make
Mindtrip's destination field useful. Mindtrip can do that from its private place index, including
curated photos. This repository explicitly declines a proprietary POI or fact database, and the
built-in Amap skill belongs to the agent runtime, requires the person's key, and covers a different
interaction boundary.

## Decision

The server exposes an authenticated, fail-soft `GET /api/locations/search` gateway to Photon, an
open-source geocoder backed by OpenStreetMap. The web dialog waits 250 ms after at least two
characters, asks for at most five city/region candidates, and shows the primary place name and its
disambiguating geographic hierarchy. Choosing one writes only that human-readable label into the
Trip's existing free-text destination; coordinates and provider identifiers are not persisted.

The default gateway is Photon's public demo endpoint. `PENGUIN_GEOCODER_URL` can point to a
self-hosted Photon endpoint, and `PENGUIN_LOCATION_SEARCH=off` makes the feature perform no network
request. The server shares concurrent identical requests, caches successful queries for one hour
and failures for one minute, follows the application proxy setting through the process-global
fetch dispatcher, and maps provider failures to an empty result with an error marker. The dialog
keeps free entry and Done available in every failure state.

Photon accepts only `de`, `en` and `fr` as a result language and answers HTTP 400 to anything
else, so the gateway forwards those three and sends `default` for every other UI locale; `default`
labels each place in its local script, the closest Photon offers for zh. Typed search fragments
leave the machine for the configured Photon service unless the opt-out is set. Provider-specific source copy is omitted from the compact dialog so its hint remains focused
on what the traveller can enter.

## Alternatives considered

- **Build a local or hosted travel place catalog.** Rejected because it is exactly the proprietary
  POI/fact database the root spec declines, and it creates a freshness problem unrelated to the
  product's transaction goal.
- **Call Mindtrip's location endpoint.** Rejected because it is a private product API and its
  Google/curated-photo data is neither this app's contract nor its data to redistribute.
- **Use the public Nominatim instance.** Rejected because its official usage policy explicitly
  forbids client-side autocomplete.
- **Call Photon directly from the browser.** Rejected because the public endpoint does not expose
  the browser CORS contract this app needs, provider errors would bypass the API's error vocabulary,
  and the request would not follow the server's application proxy setting.
- **Use the bundled Amap skill.** Rejected for this UI boundary: it needs an Agent vault key, is
  intentionally invoked by the model, and is optimized for mainland-China research rather than a
  global pre-message typeahead.
- **Keep free text only.** Rejected because the observed ambiguity and absence of any feedback are
  a concrete interaction gap; free text remains as the fallback rather than the whole feature.

## Consequences

Destination suggestions are useful but non-authoritative: Photon offers no availability guarantee,
and there are no curated photos comparable to Mindtrip's private index. The UI therefore uses a
neutral place icon, exposes failure as “suggestions unavailable,” and never requires a selection.
Server tests pin response normalization, caching, auth, validation and fail-soft behavior; browser
tests pin listbox semantics, keyboard selection and the canonical label written into the chip.
