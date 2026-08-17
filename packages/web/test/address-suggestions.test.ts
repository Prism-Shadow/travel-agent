/**
 * The address bar's completion list.
 *
 * Two of these are the difference between a list that helps and one that fights the user, and both
 * are invisible until they go wrong: a slow answer for an earlier query overwriting a newer list,
 * and Enter navigating to a suggestion when the user had typed a complete address and never touched
 * the arrow keys.
 */
import { describe, expect, it } from "vitest";

import {
  chosenUrl,
  close,
  EMPTY_SUGGESTIONS,
  MAX_SUGGESTIONS,
  move,
  receive,
  suggestionLabel,
} from "../src/features/chat/address-suggestions";
import type { DesktopHistoryEntry } from "../src/lib/desktop-bridge";

function entry(url: string, title = ""): DesktopHistoryEntry {
  return { url, title, visitCount: 1, lastVisitedAt: null };
}

const THREE = [entry("https://a.example"), entry("https://b.example"), entry("https://c.example")];

describe("receiving an answer", () => {
  it("opens the list and keeps nothing selected", () => {
    const state = receive(EMPTY_SUGGESTIONS, { entries: THREE, sequence: 1 });
    expect(state.open).toBe(true);
    expect(state.entries).toHaveLength(3);
    // Not 0. With the first row pre-selected, Enter after typing a full address would navigate to
    // a suggestion instead of what was typed.
    expect(state.selected).toBeNull();
  });

  it("stays closed when there is nothing to suggest", () => {
    expect(receive(EMPTY_SUGGESTIONS, { entries: [], sequence: 1 }).open).toBe(false);
  });

  it("drops a late answer for an earlier query", () => {
    // Typing `ct`, `ctr`, `ctri` can answer out of order; the oldest reply must not win.
    const current = receive(EMPTY_SUGGESTIONS, { entries: THREE, sequence: 5 });
    const stale = receive(current, { entries: [entry("https://old.example")], sequence: 3 });
    expect(stale).toBe(current);
    expect(stale.entries.map((e) => e.url)).toEqual(THREE.map((e) => e.url));
  });

  it("accepts an answer for the same query, so a retry is not discarded", () => {
    const current = receive(EMPTY_SUGGESTIONS, { entries: THREE, sequence: 5 });
    const same = receive(current, { entries: [entry("https://new.example")], sequence: 5 });
    expect(same.entries.map((e) => e.url)).toEqual(["https://new.example"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 40 }, (_, index) => entry(`https://s${index}.example`));
    expect(receive(EMPTY_SUGGESTIONS, { entries: many, sequence: 1 }).entries).toHaveLength(
      MAX_SUGGESTIONS,
    );
  });

  it("clears a stale highlight when new suggestions arrive", () => {
    // Keeping the index would leave the highlight on an unrelated row of a different list.
    const first = move(receive(EMPTY_SUGGESTIONS, { entries: THREE, sequence: 1 }), 1);
    expect(first.selected).toBe(0);
    const second = receive(first, { entries: [entry("https://z.example")], sequence: 2 });
    expect(second.selected).toBeNull();
  });
});

describe("moving the highlight", () => {
  const open = receive(EMPTY_SUGGESTIONS, { entries: THREE, sequence: 1 });

  it("enters the list at the top going down, and at the bottom going up", () => {
    expect(move(open, 1).selected).toBe(0);
    expect(move(open, -1).selected).toBe(2);
  });

  it("walks down the list", () => {
    expect(move(move(open, 1), 1).selected).toBe(1);
  });

  it("returns to the typed text off the top rather than wrapping to the bottom", () => {
    // Getting back to your own input should not mean walking through every suggestion.
    expect(move(move(open, 1), -1).selected).toBeNull();
  });

  it("returns to the typed text off the bottom, so the list has an exit", () => {
    const atLast = move(open, -1);
    expect(atLast.selected).toBe(2);
    expect(move(atLast, 1).selected).toBeNull();
  });

  it("does nothing when the list is closed or empty", () => {
    expect(move(EMPTY_SUGGESTIONS, 1)).toBe(EMPTY_SUGGESTIONS);
    const closed = close(open);
    expect(move(closed, 1)).toBe(closed);
  });
});

describe("what Enter acts on", () => {
  const open = receive(EMPTY_SUGGESTIONS, { entries: THREE, sequence: 1 });

  it("is the typed text when nothing was highlighted", () => {
    // The case that matters: type a whole address, press Enter, go there — not to a suggestion.
    expect(chosenUrl(open)).toBeNull();
  });

  it("is the highlighted suggestion once the arrows were used", () => {
    expect(chosenUrl(move(open, 1))).toBe("https://a.example");
  });

  it("is the typed text again after the list is closed", () => {
    expect(chosenUrl(close(move(open, 1)))).toBeNull();
  });
});

describe("how a suggestion reads", () => {
  it("leads with the title and keeps the URL underneath", () => {
    expect(suggestionLabel(entry("https://www.ctrip.com", "携程旅行网"))).toEqual({
      primary: "携程旅行网",
      secondary: "https://www.ctrip.com",
    });
  });

  it("shows only the URL when there is no title", () => {
    expect(suggestionLabel(entry("https://a.example", "   "))).toEqual({
      primary: "https://a.example",
      secondary: "",
    });
  });
});
