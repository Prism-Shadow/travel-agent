/**
 * Fail-soft destination suggestions over Photon, an open-source geocoder backed by
 * OpenStreetMap. The app stores only the selected display label; it does not build or retain a
 * POI database.
 *
 * Queries are cached in memory and concurrent identical lookups share one request. The public
 * Photon instance explicitly permits reasonable project use but offers no availability promise,
 * so every provider failure becomes an ordinary empty response and the UI keeps free text usable.
 */
import type { LocationSearchResponse, LocationSuggestion } from "../api/types.js";

export const DEFAULT_PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
export const LOCATION_SUCCESS_TTL_MS = 60 * 60 * 1000;
export const LOCATION_FAILURE_TTL_MS = 60 * 1000;
const CACHE_LIMIT = 100;
const RESULT_LIMIT = 5;
const SEARCH_TIMEOUT_MS = 5_000;
// A trip destination is a city or broad region. Smaller locality/district/county layers make an
// exact hamlet name outrank globally recognizable cities ("Lon" put an Italian locality above
// London), which is correct geocoding and poor travel typeahead.
const SEARCH_LAYERS = ["city", "state", "country"] as const;

interface PhotonFeature {
  properties?: {
    osm_type?: unknown;
    osm_id?: unknown;
    name?: unknown;
    district?: unknown;
    city?: unknown;
    county?: unknown;
    state?: unknown;
    country?: unknown;
  };
  geometry?: { coordinates?: unknown };
}

interface PhotonResponse {
  features?: unknown;
}

export interface LocationSearchServiceOptions {
  /** Test double for the provider request (defaults to the process-global, proxy-aware fetch). */
  fetchImpl?: typeof fetch;
  /** Injectable clock for deterministic cache tests. */
  now?: () => number;
  /** Environment carrying the provider URL and the privacy/air-gap opt-out. */
  env?: Record<string, string | undefined>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function appendUnique(parts: string[], value: string, name: string): void {
  if (value === "" || value.localeCompare(name, undefined, { sensitivity: "accent" }) === 0) return;
  if (parts.some((part) => part.localeCompare(value, undefined, { sensitivity: "accent" }) === 0)) {
    return;
  }
  parts.push(value);
}

/** Converts Photon's permissive GeoJSON payload into the narrow UI contract. */
export function parsePhotonSuggestions(body: PhotonResponse): LocationSuggestion[] | null {
  if (!Array.isArray(body.features)) return null;
  const suggestions: LocationSuggestion[] = [];
  for (const [index, raw] of body.features.entries()) {
    if (suggestions.length >= RESULT_LIMIT || typeof raw !== "object" || raw === null) continue;
    const feature = raw as PhotonFeature;
    const properties = feature.properties;
    if (properties === undefined) continue;
    const name = text(properties.name);
    if (name === "") continue;

    const parts: string[] = [];
    appendUnique(parts, text(properties.district), name);
    appendUnique(parts, text(properties.city), name);
    appendUnique(parts, text(properties.county), name);
    appendUnique(parts, text(properties.state), name);
    appendUnique(parts, text(properties.country), name);
    const detail = parts.join(", ");

    const osmType = text(properties.osm_type);
    const osmId =
      typeof properties.osm_id === "string" || typeof properties.osm_id === "number"
        ? String(properties.osm_id)
        : "";
    const coordinates = Array.isArray(feature.geometry?.coordinates)
      ? feature.geometry.coordinates.join(":")
      : "";
    suggestions.push({
      id: osmType !== "" && osmId !== "" ? `${osmType}:${osmId}` : `${coordinates}:${index}`,
      name,
      detail,
      label: detail === "" ? name : `${name}, ${detail}`,
    });
  }
  return suggestions;
}

// Photon rejects any `lang` outside this set with HTTP 400, so an unsupported UI language (zh, the
// web default, among them) must not be forwarded verbatim: it would turn every query into a cached
// failure. `default` returns each place under its local-script name, which is the closest Photon
// offers for those languages.
const PHOTON_LANGUAGES = new Set(["de", "en", "fr"]);

export function providerLanguage(locale: string): string {
  const match = /^[a-z]{2,3}/i.exec(locale.trim());
  const language = match?.[0]?.toLowerCase() ?? "";
  return PHOTON_LANGUAGES.has(language) ? language : "default";
}

export class LocationSearchService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;
  private readonly cache = new Map<
    string,
    { response: LocationSearchResponse; expiresAt: number }
  >();
  private readonly inflight = new Map<string, Promise<LocationSearchResponse>>();

  constructor(options: LocationSearchServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
  }

  async search(query: string, locale: string): Promise<LocationSearchResponse> {
    if (this.env["PENGUIN_LOCATION_SEARCH"] === "off") {
      return { suggestions: [], error: "disabled" };
    }
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    const language = providerLanguage(locale);
    const key = `${language}\u0000${normalizedQuery.toLocaleLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && this.now() < cached.expiresAt) return cached.response;

    const pending = this.inflight.get(key);
    if (pending) return pending;
    const lookup = this.lookup(normalizedQuery, language).then((response) => {
      const ttl = response.error === undefined ? LOCATION_SUCCESS_TTL_MS : LOCATION_FAILURE_TTL_MS;
      this.cache.delete(key);
      this.cache.set(key, { response, expiresAt: this.now() + ttl });
      while (this.cache.size > CACHE_LIMIT) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return response;
    });
    this.inflight.set(key, lookup);
    try {
      return await lookup;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async lookup(query: string, language: string): Promise<LocationSearchResponse> {
    let url: URL;
    try {
      url = new URL(this.env["PENGUIN_GEOCODER_URL"] ?? DEFAULT_PHOTON_ENDPOINT);
    } catch {
      return { suggestions: [], error: "bad_response" };
    }
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(RESULT_LIMIT));
    url.searchParams.set("lang", language);
    for (const layer of SEARCH_LAYERS) url.searchParams.append("layer", layer);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: "application/geo+json, application/json",
          "user-agent": "travel-agent-location-search",
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
    } catch {
      return { suggestions: [], error: "network" };
    }
    if (response.status === 403 || response.status === 429) {
      return { suggestions: [], error: "rate_limited" };
    }
    if (!response.ok) return { suggestions: [], error: "bad_response" };

    let body: PhotonResponse;
    try {
      body = (await response.json()) as PhotonResponse;
    } catch {
      return { suggestions: [], error: "bad_response" };
    }
    const suggestions = parsePhotonSuggestions(body);
    return suggestions === null ? { suggestions: [], error: "bad_response" } : { suggestions };
  }
}
