/**
 * Argument validation for the in-app browser bridge (src/ipc.ts).
 *
 * The preload declares which capabilities exist; these functions decide whether a given call may do
 * anything. They are tested apart from Electron because the rule under test is not "does IPC work"
 * but "does a malformed payload get rejected rather than coerced" — a renderer bug that quietly
 * becomes a view in the wrong place is exactly what this is meant to prevent (design/002 §5.1).
 */
import { describe, expect, it } from "vitest";
import {
  parseBackend,
  parseBoolean,
  parseId,
  parseImportKinds,
  parseMeasurement,
  parseOutcome,
  parseSourceIdArgument,
  parseZoomFactor,
} from "../src/ipc.js";

describe("parseMeasurement", () => {
  it("accepts a well-formed rectangle", () => {
    expect(parseMeasurement({ x: 10, y: 20, width: 300, height: 400 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });
  });

  it("accepts a negative origin, which a scrolled element legitimately has", () => {
    expect(parseMeasurement({ x: -5, y: -12, width: 300, height: 400 })?.x).toBe(-5);
  });

  it("accepts null, which means the placeholder is gone", () => {
    // Not a missing value: the pane closed, the window became too narrow, or the component
    // unmounted. Main hides the view instead of leaving it parked over the conversation.
    expect(parseMeasurement(null)).toBeNull();
  });

  it("still rejects undefined, which is a bug rather than a message", () => {
    expect(() => parseMeasurement(undefined)).toThrow();
  });

  it.each([
    ["a string", "300"],
    ["an array", [1, 2, 3, 4]],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(() => parseMeasurement(value)).toThrow();
  });

  it.each(["x", "y", "width", "height"])("rejects a missing %s", (field) => {
    const rect: Record<string, number> = { x: 1, y: 2, width: 3, height: 4 };
    delete rect[field];
    expect(() => parseMeasurement(rect)).toThrow(new RegExp(field));
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "10"],
  ])("rejects %s as a coordinate", (_label, value) => {
    expect(() => parseMeasurement({ x: value, y: 0, width: 10, height: 10 })).toThrow();
  });

  it("rejects a negative size rather than clamping it to zero", () => {
    expect(() => parseMeasurement({ x: 0, y: 0, width: -1, height: 10 })).toThrow(/negative/);
    expect(() => parseMeasurement({ x: 0, y: 0, width: 10, height: -1 })).toThrow(/negative/);
  });

  it("rejects a dimension larger than any real display", () => {
    expect(() => parseMeasurement({ x: 0, y: 0, width: 1e9, height: 10 })).toThrow(/out of range/);
  });
});

describe("parseBoolean", () => {
  it("accepts booleans", () => {
    expect(parseBoolean(true, "open")).toBe(true);
    expect(parseBoolean(false, "open")).toBe(false);
  });

  it.each([
    ["a truthy string", "true"],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s instead of coercing it", (_label, value) => {
    expect(() => parseBoolean(value, "open")).toThrow(/open/);
  });
});

describe("parseId", () => {
  it("accepts an ordinary id", () => {
    expect(parseId("session-2026-08-15-10-00-00-abcd1234", "sessionId")).toBe(
      "session-2026-08-15-10-00-00-abcd1234",
    );
  });

  it.each([
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["an object", {}],
  ])("rejects %s", (_label, value) => {
    expect(() => parseId(value, "sessionId")).toThrow(/sessionId/);
  });

  it("rejects something far longer than any id", () => {
    expect(() => parseId("x".repeat(200), "sessionId")).toThrow(/too long/);
  });
});

describe("parseOutcome", () => {
  it.each(["read_only", "committed", "failed", "unknown"])("accepts %s", (outcome) => {
    expect(parseOutcome(outcome)).toBe(outcome);
  });

  it.each(["", "READ_ONLY", "done", 1, null])("rejects %s", (value) => {
    expect(() => parseOutcome(value)).toThrow(/outcome/);
  });
});

describe("parseBackend", () => {
  it.each(["iab", "extension"])("accepts %s", (backend) => {
    expect(parseBackend(backend)).toBe(backend);
  });

  it.each(["firefox", "", null, 2])("rejects %s", (value) => {
    expect(() => parseBackend(value)).toThrow(/backend/);
  });
});

describe("parseZoomFactor", () => {
  it.each([0.5, 0.8, 1, 1.25, 2])("accepts %s", (factor) => {
    expect(parseZoomFactor(factor)).toBe(factor);
  });

  it.each([0.49, 2.01, Number.NaN, Number.POSITIVE_INFINITY, "1", null])("rejects %s", (value) => {
    expect(() => parseZoomFactor(value)).toThrow(/zoom factor/);
  });
});

describe("parseImportKinds", () => {
  it("accepts the three kinds the dialog offers", () => {
    expect(parseImportKinds(["passwords", "cookies", "history"])).toEqual([
      "passwords",
      "cookies",
      "history",
    ]);
  });

  it("deduplicates rather than refusing a repetitive list", () => {
    // Importing one kind twice would do the work twice, and for history would double a page's
    // visit count. A bad list is rejected; a merely repetitive one is normalised.
    expect(parseImportKinds(["cookies", "cookies"])).toEqual(["cookies"]);
  });

  it("rejects an empty selection, which would be an import that does nothing", () => {
    expect(() => parseImportKinds([])).toThrow(/non-empty/);
  });

  it.each([["bookmarks"], ["Cookies"], [""], [null], [42], [{}]])(
    "rejects %s as a kind",
    (value) => {
      expect(() => parseImportKinds([value])).toThrow(/each kind/);
    },
  );

  it.each([null, undefined, "cookies", {}])("rejects %s as the list itself", (value) => {
    expect(() => parseImportKinds(value)).toThrow(/kinds/);
  });

  it("rejects a list longer than the number of kinds that exist", () => {
    expect(() => parseImportKinds(["cookies", "cookies", "cookies", "cookies"])).toThrow(
      /too many/,
    );
  });
});

describe("parseSourceIdArgument", () => {
  it("accepts an id of the shape this app issues", () => {
    expect(parseSourceIdArgument("chrome:Default")).toBe("chrome:Default");
    expect(parseSourceIdArgument("edge:Profile 2")).toBe("edge:Profile 2");
  });

  it("refuses anything that could name a file instead of a profile", () => {
    // This is the channel's whole security boundary: a source id is a name main issued, never a
    // path. Without it, "import" would be "read any SQLite file on the disk and hand it back
    // decrypted".
    for (const id of [
      "chrome:../../../../etc/passwd",
      "chrome:/etc/passwd",
      "chrome:Default/../Local State",
      "chrome:..",
      "firefox:Default",
      "Default",
    ]) {
      expect(() => parseSourceIdArgument(id), id).toThrow(/sourceId/);
    }
  });

  it.each([null, undefined, 42, "", {}])("rejects %s", (value) => {
    expect(() => parseSourceIdArgument(value)).toThrow(/sourceId/);
  });
});
