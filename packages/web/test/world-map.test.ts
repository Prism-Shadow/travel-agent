import { describe, expect, it } from "vitest";
import DottedMap from "dotted-map";
import { MAP_HEIGHT, MAP_REGION, MAP_WIDTH, projectMapPoint } from "../src/lib/world-map-geometry";

describe("world map projection", () => {
  it("keeps route cities within one dot of the basemap library's projected locations", () => {
    const map = new DottedMap({
      height: 72,
      grid: "diagonal",
      region: MAP_REGION,
      projection: { name: "equirectangular" },
    });
    for (const location of [
      { lat: 40.7128, lng: -74.006 },
      { lat: 51.5074, lng: -0.1278 },
      { lat: 31.2304, lng: 121.4737 },
      { lat: -33.8688, lng: 151.2093 },
    ]) {
      const pin = map.getPin(location)!;
      const point = projectMapPoint(location)!;
      expect(Math.abs(point.x - (pin.x / map.image.width) * MAP_WIDTH)).toBeLessThan(
        MAP_WIDTH / map.image.width,
      );
      expect(Math.abs(point.y - (pin.y / map.image.height) * MAP_HEIGHT)).toBeLessThan(
        MAP_HEIGHT / map.image.height,
      );
    }
  });

  it("omits non-finite coordinates and locations outside the visible map", () => {
    for (const location of [
      { lat: NaN, lng: 0 },
      { lat: 0, lng: Infinity },
      { lat: 90, lng: 0 },
      { lat: 0, lng: -181 },
    ]) {
      expect(projectMapPoint(location)).toBeNull();
    }
  });
});
