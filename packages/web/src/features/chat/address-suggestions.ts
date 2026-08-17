/**
 * The address bar's completion list: what to show, and which entry the keyboard is on.
 *
 * Kept apart from the component because the interesting parts are not rendering. Two of them are
 * the difference between a completion list that helps and one that fights the user:
 *
 * - **A stale answer must never replace a newer one.** Every query is a round trip to the main
 *   process, and they do not necessarily come back in order — typing `ct`, `ctr`, `ctri` can answer
 *   `ct` last. `sequence` exists so a late reply for an earlier query is dropped rather than
 *   overwriting the list the user is looking at.
 *
 * - **"Nothing selected" is a real state, not index 0.** With the first row pre-selected, pressing
 *   Enter after typing a full address would navigate to a *suggestion* instead of what was typed.
 *   So the selection starts at `null`, meaning "use what is in the box", and only a deliberate
 *   arrow-key press moves onto the list. Arrow-up from the top returns to `null` rather than
 *   wrapping to the bottom, for the same reason: the way back to your own text should not require
 *   walking through every suggestion.
 */
import type { DesktopHistoryEntry } from "../../lib/desktop-bridge";

/** How many suggestions the list shows. Beyond this it stops being a shortcut. */
export const MAX_SUGGESTIONS = 8;

/** How long to wait after a keystroke before asking. One frame of typing, not a perceptible pause. */
export const SUGGEST_DEBOUNCE_MS = 120;

export interface SuggestionState {
  entries: DesktopHistoryEntry[];
  /** Index into `entries`, or null for "the text the user typed". */
  selected: number | null;
  /** Which query the entries belong to, so a late answer for an earlier one can be dropped. */
  sequence: number;
  open: boolean;
}

export const EMPTY_SUGGESTIONS: SuggestionState = {
  entries: [],
  selected: null,
  sequence: 0,
  open: false,
};

/**
 * Accepts an answer if it is still the current one.
 *
 * Returns the previous state unchanged for a stale reply, which is what lets the caller assign
 * unconditionally without checking first.
 */
export function receive(
  state: SuggestionState,
  answer: { entries: DesktopHistoryEntry[]; sequence: number },
): SuggestionState {
  if (answer.sequence < state.sequence) return state;
  const entries = answer.entries.slice(0, MAX_SUGGESTIONS);
  return {
    entries,
    // A new set of suggestions is a new list; keeping an index into the old one would leave the
    // highlight on an unrelated row.
    selected: null,
    sequence: answer.sequence,
    open: entries.length > 0,
  };
}

/** Moves the highlight. `null` is above the first row, and is where the user's own text lives. */
export function move(state: SuggestionState, direction: 1 | -1): SuggestionState {
  if (!state.open || state.entries.length === 0) return state;
  const last = state.entries.length - 1;
  if (state.selected === null) {
    // Down enters the list at the top; up enters it at the bottom, which is what a browser does.
    return { ...state, selected: direction === 1 ? 0 : last };
  }
  const next = state.selected + direction;
  // Off the top returns to the typed text rather than wrapping: getting back to your own input
  // should not mean walking the whole list.
  if (next < 0) return { ...state, selected: null };
  // Off the bottom wraps to the typed text for the same reason, and so the list has an exit.
  if (next > last) return { ...state, selected: null };
  return { ...state, selected: next };
}

export function close(state: SuggestionState): SuggestionState {
  return { ...state, open: false, selected: null };
}

/** What Enter should act on: a highlighted suggestion's URL, or null for "what was typed". */
export function chosenUrl(state: SuggestionState): string | null {
  if (!state.open || state.selected === null) return null;
  return state.entries[state.selected]?.url ?? null;
}

/**
 * How a suggestion reads in the list.
 *
 * The title first when there is one, because "携程旅行网" identifies a page faster than its URL;
 * the URL always, because two pages can share a title and the address is what is actually opened.
 */
export function suggestionLabel(entry: DesktopHistoryEntry): {
  primary: string;
  secondary: string;
} {
  const title = entry.title.trim();
  return title === ""
    ? { primary: entry.url, secondary: "" }
    : { primary: title, secondary: entry.url };
}
