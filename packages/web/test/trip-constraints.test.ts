/**
 * Trip-constraint composition (trip-constraints.ts): the chips are prompt scaffolding, so
 * these tests pin the exact text the model receives — per-chip lines, the fixed
 * Where/When/Who/Budget order, both locales' copy, and the prefix splice into the outgoing
 * input parts (first text part, attachment-only sends, untouched pass-through when empty).
 */
import { describe, expect, it } from "vitest";
import type { TaskInputPart } from "@prismshadow/penguin-server/api";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";
import {
  EMPTY_TRIP_CONSTRAINTS,
  applyTripPrefix,
  composeTripPrefix,
  constraintsToTripPatch,
  isEmptyTrip,
  tripToConstraints,
  whenIsSet,
} from "../src/features/chat/trip-constraints";
import type { TripConstraints } from "../src/features/chat/trip-constraints";
import type { TripSummary } from "@prismshadow/penguin-server/api";

const ZH = zh.chat.tripChips;
const EN = en.chat.tripChips;

const full: TripConstraints = {
  where: "东京、大阪",
  when: { kind: "dates", start: "2026-10-01", end: "2026-10-05" },
  who: { adults: 2, children: 1, infants: 0, pets: 0 },
  budget: "mid",
};

describe("composeTripPrefix", () => {
  it("composes every filled chip as one line, in Where/When/Who/Budget order", () => {
    expect(composeTripPrefix(full, ZH)).toBe(
      "目的地：东京、大阪\n日期：2026-10-01 至 2026-10-05\n人数：2 成人、1 儿童\n预算：舒适（$$）",
    );
  });

  it("renders the same constraints through the English copy", () => {
    expect(composeTripPrefix(full, EN)).toBe(
      "Where: 东京、大阪\nWhen: 2026-10-01 to 2026-10-05\nWho: 2 adults, 1 child\nBudget: sensibly priced ($$)",
    );
  });

  it("is empty for the empty constraints", () => {
    expect(composeTripPrefix(EMPTY_TRIP_CONSTRAINTS, ZH)).toBe("");
  });

  it("keeps a single filled chip on its own", () => {
    expect(composeTripPrefix({ ...EMPTY_TRIP_CONSTRAINTS, where: " 京都 " }, ZH)).toBe(
      "目的地：京都",
    );
  });

  it("words one-sided date ranges as departure / return-by", () => {
    const from = {
      ...EMPTY_TRIP_CONSTRAINTS,
      when: { kind: "dates", start: "2026-10-01", end: "" },
    } as TripConstraints;
    const until = {
      ...EMPTY_TRIP_CONSTRAINTS,
      when: { kind: "dates", start: "", end: "2026-10-05" },
    } as TripConstraints;
    expect(composeTripPrefix(from, ZH)).toBe("日期：2026-10-01 出发");
    expect(composeTripPrefix(until, ZH)).toBe("日期：2026-10-05 前返回");
  });

  it("covers the three flexible-when shapes", () => {
    const both = {
      ...EMPTY_TRIP_CONSTRAINTS,
      when: { kind: "flexible", days: 5, month: "2026-10" },
    } as TripConstraints;
    const daysOnly = {
      ...EMPTY_TRIP_CONSTRAINTS,
      when: { kind: "flexible", days: 5, month: "" },
    } as TripConstraints;
    const monthOnly = {
      ...EMPTY_TRIP_CONSTRAINTS,
      when: { kind: "flexible", days: 0, month: "2026-10" },
    } as TripConstraints;
    expect(composeTripPrefix(both, ZH)).toBe("日期：2026-10 内任意 5 天");
    expect(composeTripPrefix(daysOnly, ZH)).toBe("日期：时间灵活，共 5 天");
    expect(composeTripPrefix(monthOnly, ZH)).toBe("日期：2026-10 内，天数待定");
  });

  it("omits zero traveller categories, and the whole line when all are zero", () => {
    const zeros = {
      ...EMPTY_TRIP_CONSTRAINTS,
      who: { adults: 0, children: 0, infants: 0, pets: 0 },
    };
    expect(composeTripPrefix(zeros, ZH)).toBe("");
    const infantsOnly = {
      ...EMPTY_TRIP_CONSTRAINTS,
      who: { adults: 0, children: 0, infants: 1, pets: 0 },
    };
    expect(composeTripPrefix(infantsOnly, ZH)).toBe("人数：1 婴儿");
  });

  it("treats the explicit any-budget tier as a real, sendable statement", () => {
    expect(composeTripPrefix({ ...EMPTY_TRIP_CONSTRAINTS, budget: "any" }, ZH)).toBe("预算：不限");
  });
});

describe("whenIsSet / isEmptyTrip", () => {
  it("a set mode with blank fields does not count as filled", () => {
    expect(whenIsSet({ kind: "dates", start: "", end: "" })).toBe(false);
    expect(whenIsSet({ kind: "flexible", days: 0, month: "" })).toBe(false);
    expect(whenIsSet(null)).toBe(false);
    expect(
      isEmptyTrip({ ...EMPTY_TRIP_CONSTRAINTS, when: { kind: "dates", start: "", end: "" } }),
    ).toBe(true);
  });

  it("who set to all-zero still reads as non-empty (the chip is engaged)", () => {
    expect(
      isEmptyTrip({
        ...EMPTY_TRIP_CONSTRAINTS,
        who: { adults: 0, children: 0, infants: 0, pets: 0 },
      }),
    ).toBe(false);
  });
});

describe("applyTripPrefix", () => {
  const text = (t: string): TaskInputPart => ({ type: "text", text: t });
  const image: TaskInputPart = { type: "image_url", imageUrl: "data:image/png;base64,x" };

  it("returns the input untouched when no chip is filled", () => {
    const input = [text("订一间酒店")];
    expect(applyTripPrefix(input, EMPTY_TRIP_CONSTRAINTS, ZH)).toBe(input);
  });

  it("prepends the block to the first text part with a blank line between", () => {
    const out = applyTripPrefix([image, text("订一间酒店")], full, ZH);
    expect(out).toEqual([image, text(`${composeTripPrefix(full, ZH)}\n\n订一间酒店`)]);
  });

  it("stands alone when the text part is blank", () => {
    const out = applyTripPrefix([text("   ")], full, ZH);
    expect(out).toEqual([text(composeTripPrefix(full, ZH))]);
  });

  it("adds a leading text part to an attachment-only send", () => {
    const out = applyTripPrefix([image], full, ZH);
    expect(out).toEqual([text(composeTripPrefix(full, ZH)), image]);
  });
});

describe("the trip folder line", () => {
  const text = (t: string): TaskInputPart => ({ type: "text", text: t });

  it("leads the block, so the agent reads the journey's files first", () => {
    // The trip-workspace skill acts on this path before anything else; it is stated in the
    // visible message like every other constraint, never through a hidden channel.
    const out = composeTripPrefix(full, EN, "/Users/p/Penguin Trips/tokyo-2026-10");
    expect(out.split("\n")[0]).toBe("Trip folder: /Users/p/Penguin Trips/tokyo-2026-10");
    expect(out).toBe(
      `Trip folder: /Users/p/Penguin Trips/tokyo-2026-10\n${composeTripPrefix(full, EN)}`,
    );
  });

  it("is the whole block for a trip whose identity is still empty", () => {
    // A journey created from one sentence knows nothing yet, but the folder still has to
    // reach the agent — otherwise the skill has nowhere to read or write.
    expect(composeTripPrefix(EMPTY_TRIP_CONSTRAINTS, EN, "/trips/t-1")).toBe(
      "Trip folder: /trips/t-1",
    );
    expect(applyTripPrefix([text("hi")], EMPTY_TRIP_CONSTRAINTS, EN, "/trips/t-1")).toEqual([
      text("Trip folder: /trips/t-1\n\nhi"),
    ]);
  });

  it("is absent for a conversation belonging to no trip", () => {
    expect(composeTripPrefix(full, EN)).not.toContain("Trip folder");
    expect(composeTripPrefix(full, EN, "")).not.toContain("Trip folder");
  });
});

describe("chips as a trip's identity", () => {
  const trip: TripSummary = {
    tripId: "t-1",
    projectId: "proj",
    name: "Autumn",
    destination: "Tokyo",
    when: { kind: "flexible", days: 5, month: "2026-10" },
    who: { adults: 2, children: 0, infants: 0, pets: 0 },
    budget: "mid",
    dir: "/trips/t-1",
    dirExists: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  it("round-trips a trip's stored identity through the chips", () => {
    const asChips = tripToConstraints(trip);
    expect(asChips).toEqual({
      where: "Tokyo",
      when: { kind: "flexible", days: 5, month: "2026-10" },
      who: { adults: 2, children: 0, infants: 0, pets: 0 },
      budget: "mid",
    });
    expect(constraintsToTripPatch(asChips)).toEqual({
      destination: "Tokyo",
      when: { kind: "flexible", days: 5, month: "2026-10" },
      who: { adults: 2, children: 0, infants: 0, pets: 0 },
      budget: "mid",
    });
  });

  it("sends cleared fields as null, so emptying a chip clears the trip", () => {
    // Every field is stated on every patch: the chips are a complete statement of identity,
    // so a field the person emptied must be cleared rather than left at its old value.
    expect(constraintsToTripPatch(EMPTY_TRIP_CONSTRAINTS)).toEqual({
      destination: "",
      when: null,
      who: null,
      budget: null,
    });
  });

  it("treats a set-but-empty date span as unset", () => {
    expect(
      constraintsToTripPatch({
        ...EMPTY_TRIP_CONSTRAINTS,
        when: { kind: "dates", start: "", end: "" },
      }).when,
    ).toBeNull();
  });

  // With a previous value, the patch carries only what this edit changed. The destination is the
  // field this protects: the agent may fill a blank one between renders, and a patch that resends
  // the component's stale snapshot would revert it while looking like the person's own answer —
  // which no server-side rule can distinguish or refuse.
  describe("constraintsToTripPatch with a previous value", () => {
    const base: TripConstraints = {
      ...EMPTY_TRIP_CONSTRAINTS,
      where: "Shanghai",
      budget: "mid",
    };

    it("sends only the changed field", () => {
      const next: TripConstraints = { ...base, budget: "high" };
      expect(constraintsToTripPatch(next, base)).toEqual({ budget: "high" });
    });

    it("does not resend a destination this edit did not touch", () => {
      const next: TripConstraints = {
        ...base,
        who: { adults: 2, children: 0, infants: 0, pets: 0 },
      };
      expect(constraintsToTripPatch(next, base)).not.toHaveProperty("destination");
    });

    it("sends the destination when it really is what changed", () => {
      const next: TripConstraints = { ...base, where: "Suzhou" };
      expect(constraintsToTripPatch(next, base)).toEqual({ destination: "Suzhou" });
    });

    it("is empty when nothing changed, so no write is issued at all", () => {
      expect(constraintsToTripPatch(base, base)).toEqual({});
    });

    it("still sends everything when there is no previous value (first write)", () => {
      expect(Object.keys(constraintsToTripPatch(base)).sort()).toEqual([
        "budget",
        "destination",
        "when",
        "who",
      ]);
    });
  });
});
