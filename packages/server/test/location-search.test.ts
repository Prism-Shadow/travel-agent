/** Destination search gateway: provider normalization, cache/failure behavior, and auth/validation. */
import { afterEach, describe, expect, it } from "vitest";
import type { LocationSearchResponse } from "../src/api/types.js";
import {
  LocationSearchService,
  parsePhotonSuggestions,
  providerLanguage,
} from "../src/services/location-search-service.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

function photonResponse(): Response {
  return new Response(
    JSON.stringify({
      features: [
        {
          properties: {
            osm_type: "N",
            osm_id: 10_797_175,
            name: "London",
            city: "London",
            state: "England",
            country: "United Kingdom",
          },
          geometry: { coordinates: [-0.1276, 51.5074] },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("LocationSearchService", () => {
  it("normalizes Photon places and caches equivalent queries", async () => {
    const urls: URL[] = [];
    const service = new LocationSearchService({
      env: {},
      fetchImpl: async (input) => {
        urls.push(new URL(String(input)));
        return photonResponse();
      },
    });

    const first = await service.search(" Lon ", "en-US");
    const cached = await service.search("lon", "en");

    expect(first).toEqual({
      suggestions: [
        {
          id: "N:10797175",
          name: "London",
          detail: "England, United Kingdom",
          label: "London, England, United Kingdom",
        },
      ],
    });
    expect(cached).toEqual(first);
    expect(urls).toHaveLength(1);
    expect(urls[0]!.searchParams.get("q")).toBe("Lon");
    expect(urls[0]!.searchParams.get("limit")).toBe("5");
    expect(urls[0]!.searchParams.get("lang")).toBe("en");
    expect(urls[0]!.searchParams.getAll("layer")).toEqual(["city", "state", "country"]);
  });

  it("forwards only the languages Photon accepts and sends `default` for every other UI locale", async () => {
    // The public instance answers HTTP 400 to any other `lang`, which the fail-soft path would
    // turn into a cached empty result: zh, the web's default language, got no suggestions at all.
    expect(providerLanguage("zh-CN")).toBe("default");
    expect(providerLanguage("ja")).toBe("default");
    expect(providerLanguage("")).toBe("default");
    expect(providerLanguage("de-DE")).toBe("de");
    expect(providerLanguage("fr")).toBe("fr");
    expect(providerLanguage("en-GB")).toBe("en");

    const languages: string[] = [];
    const service = new LocationSearchService({
      env: {},
      fetchImpl: async (input) => {
        languages.push(new URL(String(input)).searchParams.get("lang") ?? "");
        return photonResponse();
      },
    });
    const response = await service.search("东京", "zh-CN");
    expect(response.error).toBeUndefined();
    expect(response.suggestions).toHaveLength(1);
    expect(languages).toEqual(["default"]);
  });

  it("fails soft for rate limits, malformed data, and the explicit opt-out", async () => {
    const limited = new LocationSearchService({
      env: {},
      fetchImpl: async () => new Response("limited", { status: 429 }),
    });
    expect(await limited.search("London", "en")).toEqual({
      suggestions: [],
      error: "rate_limited",
    });

    expect(parsePhotonSuggestions({ features: "not-an-array" })).toBeNull();
    const malformed = new LocationSearchService({
      env: {},
      fetchImpl: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }),
    });
    expect(await malformed.search("London", "en")).toEqual({
      suggestions: [],
      error: "bad_response",
    });

    let calls = 0;
    const disabled = new LocationSearchService({
      env: { PENGUIN_LOCATION_SEARCH: "off" },
      fetchImpl: async () => {
        calls += 1;
        return photonResponse();
      },
    });
    expect(await disabled.search("London", "en")).toEqual({
      suggestions: [],
      error: "disabled",
    });
    expect(calls).toBe(0);
  });
});

describe("GET /api/locations/search", () => {
  let app: TestApp;

  afterEach(async () => {
    await app.cleanup();
  });

  it("requires auth, validates the query, and returns the fail-soft service response", async () => {
    const locationSearch = new LocationSearchService({
      env: {},
      fetchImpl: async () => photonResponse(),
    });
    app = await createTestApp({ locationSearch });

    expect((await app.app.request("/api/locations/search?q=Lon&lang=en-US")).status).toBe(401);
    const admin = await loginAdmin(app.app);
    const client = apiClient(app.app, admin.cookie);

    const invalid = await client.get("/api/locations/search?q=L&lang=en-US");
    expect(invalid.status).toBe(400);

    const response = await client.get("/api/locations/search?q=Lon&lang=en-US");
    expect(response.status).toBe(200);
    const body = (await response.json()) as LocationSearchResponse;
    expect(body.suggestions[0]?.label).toBe("London, England, United Kingdom");
  });
});
