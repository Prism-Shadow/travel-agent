import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  selectTravelCovers,
  TRAVEL_COVER_CATALOG,
  type TravelCoverSubject,
} from "../src/lib/travel-cover-library";

const coverDirectory = fileURLToPath(new URL("../public/travel-covers/", import.meta.url));

interface JpegFrame {
  marker: number;
  width: number;
  height: number;
  components: number;
}

function readJpegFrame(buffer: Buffer): JpegFrame {
  expect(buffer[0]).toBe(0xff);
  expect(buffer[1]).toBe(0xd8);

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd8 || marker === 0xd9) continue;

    const segmentLength = buffer.readUInt16BE(offset);
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      return {
        marker,
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
        components: buffer[offset + 7] ?? 0,
      };
    }
    offset += segmentLength;
  }

  throw new Error("JPEG frame marker not found");
}

describe("travel cover catalog", () => {
  it("contains the 84 unique assets delivered through Batch A", () => {
    expect(TRAVEL_COVER_CATALOG).toHaveLength(84);
    expect(new Set(TRAVEL_COVER_CATALOG.map((asset) => asset.id)).size).toBe(84);
    expect(new Set(TRAVEL_COVER_CATALOG.map((asset) => asset.src)).size).toBe(84);
    expect(TRAVEL_COVER_CATALOG.filter((asset) => asset.promptVersion === 1)).toHaveLength(48);
    expect(TRAVEL_COVER_CATALOG.filter((asset) => asset.promptVersion === 2)).toHaveLength(36);
    expect(
      Object.fromEntries(
        ["destination", "activity", "season", "generic"].map((kind) => [
          kind,
          TRAVEL_COVER_CATALOG.filter((asset) => asset.kind === kind).length,
        ]),
      ),
    ).toEqual({ destination: 42, activity: 21, season: 12, generic: 9 });
    expect(
      TRAVEL_COVER_CATALOG.every(
        (asset) => asset.src === `/travel-covers/${asset.id}.jpg` && asset.source === "generated",
      ),
    ).toBe(true);
  });

  it("has one-to-one parity between the catalog and public JPEG files", () => {
    const catalogFiles = TRAVEL_COVER_CATALOG.map((asset) => `${asset.id}.jpg`).sort();
    const publicFiles = readdirSync(coverDirectory)
      .filter((name) => name.endsWith(".jpg"))
      .sort();

    expect(publicFiles).toEqual(catalogFiles);
    for (const asset of TRAVEL_COVER_CATALOG) {
      const file = fileURLToPath(new URL(`../public${asset.src}`, import.meta.url));
      expect(existsSync(file), `${asset.id} is missing`).toBe(true);
    }
  });

  it("keeps runtime files progressive, stripped, and within the image budget", () => {
    let totalBytes = 0;
    for (const asset of TRAVEL_COVER_CATALOG) {
      const file = fileURLToPath(new URL(`../public${asset.src}`, import.meta.url));
      const buffer = readFileSync(file);
      const frame = readJpegFrame(buffer);
      const bytes = statSync(file).size;
      totalBytes += bytes;

      expect(frame, asset.id).toEqual({ marker: 0xc2, width: 960, height: 720, components: 3 });
      expect(buffer.includes(Buffer.from("Exif\0\0")), `${asset.id} contains EXIF`).toBe(false);
      expect(buffer.includes(Buffer.from("ICC_PROFILE")), `${asset.id} contains ICC metadata`).toBe(
        false,
      );
      expect(
        buffer.includes(Buffer.from("http://ns.adobe.com/xap/1.0/")),
        `${asset.id} contains XMP`,
      ).toBe(false);
      expect(bytes, `${asset.id} exceeds 250 KiB`).toBeLessThanOrEqual(250 * 1024);
    }

    expect(totalBytes / TRAVEL_COVER_CATALOG.length).toBeLessThanOrEqual(160 * 1024);
    expect(totalBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  });
});

describe("selectTravelCovers", () => {
  it.each([
    ["Five-Day Tokyo Trip Plan", "tokyo-night"],
    ["上海到大阪的往返航班", "flight-window"],
    ["京都秋季红叶行程", "kyoto-temple"],
    ["Family holiday with two children", "family-trip"],
    ["Plan a northern lights escape", "northern-lights"],
    ["Hokkaido summer flower fields", "hokkaido-flower-fields"],
    ["香港雨季城市漫游", "hong-kong-harbour-rain"],
    ["墨尔本秋日咖啡慢游", "melbourne-laneway-morning"],
    ["喀拉拉水乡放松之旅", "kerala-backwaters"],
    ["Hanoi old-quarter weekend", "hanoi-old-quarter"],
    ["Overnight sleeper train through the mountains", "overnight-train-cabin"],
    ["Ferry island hopping holiday", "ferry-island-hopping"],
    ["Quiet tea ceremony afternoon", "tea-ceremony-table"],
    ["Night market stroll", "night-market-stroll"],
    ["Palawan snorkeling over the reef", "snorkeling-lagoon"],
    ["Family holiday with grandparents", "multi-generation-family-holiday"],
    ["A spring rain garden escape", "spring-rain-garden"],
  ])("matches %s to %s", (title, expected) => {
    expect(selectTravelCovers([{ sessionId: "session-1", title }])[0]?.id).toBe(expected);
  });

  it("uses only neutral generic covers when no intent can be inferred", () => {
    const selected = selectTravelCovers([
      { sessionId: "a", title: "Greeting Exchange" },
      { sessionId: "b", title: "Assistance Intro" },
      { sessionId: "c", title: null },
    ]);
    expect(selected.every((asset) => asset.kind === "generic")).toBe(true);
  });

  it("avoids adjacent duplicates when alternatives exist", () => {
    const subjects: TravelCoverSubject[] = [
      { sessionId: "same", title: "hello" },
      { sessionId: "same", title: "hello" },
      { sessionId: "same", title: "hello" },
    ];
    const selected = selectTravelCovers(subjects);
    expect(new Set(selected.map((asset) => asset.id)).size).toBe(3);
  });

  it("excludes covers reserved by another visible rail", () => {
    const selected = selectTravelCovers(
      [{ sessionId: "kyoto-session", title: "Kyoto Autumn Foliage Itinerary" }],
      TRAVEL_COVER_CATALOG,
      { excludedIds: new Set(["kyoto-temple"]) },
    );

    expect(selected[0]?.id).toBe("autumn-forest");
  });

  it("is stable for the same Session and title", () => {
    const subject = [{ sessionId: "stable-session", title: "Weekend plan" }];
    expect(selectTravelCovers(subject)[0]?.id).toBe(selectTravelCovers(subject)[0]?.id);
  });
});
