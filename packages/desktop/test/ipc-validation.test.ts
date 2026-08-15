/**
 * Argument validation for the in-app browser bridge (src/ipc.ts).
 *
 * The preload declares which capabilities exist; these functions decide whether a given call may do
 * anything. They are tested apart from Electron because the rule under test is not "does IPC work"
 * but "does a malformed payload get rejected rather than coerced" — a renderer bug that quietly
 * becomes a view in the wrong place is exactly what this is meant to prevent (design/002 §5.1).
 */
import { describe, expect, it } from "vitest";
import { parseBoolean, parseMeasurement } from "../src/ipc.js";

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
