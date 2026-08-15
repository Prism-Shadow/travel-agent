/**
 * The browser shortcut table (src/browser-shortcuts.ts).
 *
 * This runs on every keypress in the window — including every character typed into the composer —
 * so what it *refuses* matters as much as what it claims. The modifier matrices below are
 * exhaustive on purpose: a table that quietly claims Ctrl+T on macOS takes a keystroke the terminal
 * emulator underneath already spoke for, and the user never learns why their transpose stopped
 * working.
 */
import { describe, expect, it } from "vitest";
import { resolveShortcut, tabIdForAction } from "../src/browser-shortcuts.js";
import type { ShortcutInput } from "../src/browser-shortcuts.js";

function key(over: Partial<ShortcutInput> & { key: string }): ShortcutInput {
  return {
    control: false,
    meta: false,
    shift: false,
    alt: false,
    platform: "darwin",
    ...over,
  };
}

/** The platform's accelerator: Command on macOS, Control everywhere else. */
function accel(k: string, platform: NodeJS.Platform = "darwin"): ShortcutInput {
  return key(platform === "darwin" ? { key: k, meta: true } : { key: k, control: true, platform });
}

describe("resolveShortcut", () => {
  it.each([
    ["t", "new-tab"],
    ["w", "close-tab"],
    ["l", "focus-address"],
    ["r", "reload"],
  ] as const)("maps the accelerator plus %s", (k, kind) => {
    expect(resolveShortcut(accel(k))).toEqual({ kind });
    expect(resolveShortcut(accel(k, "linux"))).toEqual({ kind });
    expect(resolveShortcut(accel(k, "win32"))).toEqual({ kind });
  });

  it("is case-insensitive, because a held Shift is not how these arrive", () => {
    expect(resolveShortcut(accel("T"))).toEqual({ kind: "new-tab" });
  });

  it("maps the brackets to history, not to tab order", () => {
    // Cmd+[ and Cmd+] are Back and Forward in Safari and Chrome. A user who reaches for them
    // mid-booking means "the previous page"; sending them to the tab strip would move the page out
    // from under them.
    expect(resolveShortcut(accel("["))).toEqual({ kind: "go-back" });
    expect(resolveShortcut(accel("]"))).toEqual({ kind: "go-forward" });
  });

  it("maps 1-8 to positions and 9 to the last tab", () => {
    expect(resolveShortcut(accel("1"))).toEqual({ kind: "select-tab", index: 0 });
    expect(resolveShortcut(accel("8"))).toEqual({ kind: "select-tab", index: 7 });
    expect(resolveShortcut(accel("9"))).toEqual({ kind: "select-last-tab" });
  });

  it("cycles tabs with Control+Tab on every platform", () => {
    // Control, not the platform accelerator: Cmd+Tab belongs to the macOS application switcher and
    // must never be intercepted.
    for (const platform of ["darwin", "linux", "win32"] as NodeJS.Platform[]) {
      expect(resolveShortcut(key({ key: "Tab", control: true, platform }))).toEqual({
        kind: "next-tab",
      });
      expect(resolveShortcut(key({ key: "Tab", control: true, shift: true, platform }))).toEqual({
        kind: "previous-tab",
      });
    }
  });

  it("never claims Command+Tab", () => {
    expect(resolveShortcut(key({ key: "Tab", meta: true }))).toBeNull();
  });

  it.each([
    ["nothing held", key({ key: "t" })],
    ["the wrong modifier on macOS", key({ key: "t", control: true })],
    ["the wrong modifier on Linux", key({ key: "t", meta: true, platform: "linux" })],
    ["both modifiers", key({ key: "t", meta: true, control: true })],
    ["Alt as well", key({ key: "t", meta: true, alt: true })],
    ["Shift as well", key({ key: "t", meta: true, shift: true })],
  ])("refuses %s", (_label, input) => {
    expect(resolveShortcut(input)).toBeNull();
  });

  it("refuses Shift on every binding, brackets and digits included", () => {
    // Shift belongs to the site's own keyboard handling. The one exception is Ctrl+Shift+Tab, which
    // is matched before this rule because Shift is part of what it means.
    for (const k of ["t", "w", "l", "r", "[", "]", "1", "9"]) {
      expect(resolveShortcut({ ...accel(k), shift: true })).toBeNull();
    }
  });

  it.each(["a", "s", "0", "Enter", "F5", "ArrowLeft"])("passes %s through", (k) => {
    expect(resolveShortcut(accel(k))).toBeNull();
  });
});

describe("tabIdForAction", () => {
  const tabs = ["t1", "t2", "t3"];

  it("selects by position", () => {
    expect(tabIdForAction({ kind: "select-tab", index: 1 }, tabs, "t1")).toBe("t2");
  });

  it("answers null for a position that is not there", () => {
    // Cmd+5 in a three-tab strip does nothing in every browser — it does not fall back to the last.
    expect(tabIdForAction({ kind: "select-tab", index: 4 }, tabs, "t1")).toBeNull();
  });

  it("resolves the last tab however many there are", () => {
    expect(tabIdForAction({ kind: "select-last-tab" }, tabs, "t1")).toBe("t3");
    expect(tabIdForAction({ kind: "select-last-tab" }, ["only"], "only")).toBe("only");
  });

  it("wraps in both directions", () => {
    expect(tabIdForAction({ kind: "next-tab" }, tabs, "t3")).toBe("t1");
    expect(tabIdForAction({ kind: "previous-tab" }, tabs, "t1")).toBe("t3");
  });

  it("starts from the first tab when nothing is active", () => {
    // The regression: clamping the missing index to 0 and adding one landed on the *second* tab,
    // because it read the clamp as "we are on the first".
    expect(tabIdForAction({ kind: "next-tab" }, tabs, null)).toBe("t1");
  });

  it("goes to the last tab when previous is asked for with nothing active", () => {
    expect(tabIdForAction({ kind: "previous-tab" }, tabs, null)).toBe("t3");
  });

  it("treats an active tab from another strip as no active tab", () => {
    expect(tabIdForAction({ kind: "next-tab" }, tabs, "elsewhere")).toBe("t1");
  });

  it("answers null for an empty strip", () => {
    for (const kind of ["next-tab", "previous-tab", "select-last-tab"] as const) {
      expect(tabIdForAction({ kind }, [], null)).toBeNull();
    }
  });

  it("leaves the active tab alone for actions that are not about selection", () => {
    expect(tabIdForAction({ kind: "reload" }, tabs, "t2")).toBe("t2");
  });
});
