/**
 * Which keystrokes belong to the browser pane.
 *
 * A table rather than a chain of `if`s in the key handler, because the same table has to answer for
 * two different focus paths and there must not be two answers. Focus can be in the app's own
 * renderer (the conversation, the composer) or inside a `WebContentsView`, which is a separate
 * `webContents` with its own input stream. Main registers `before-input-event` on both and asks this
 * function; nothing about the decision depends on which one asked.
 *
 * Main is also the only place that *can* own these. Electron documents `before-input-event` +
 * `preventDefault()` as suppressing menu accelerators as well as the page's key events, which is
 * what lets Cmd+R reload the active tab instead of the application window while `menu.ts` keeps its
 * standard roles.
 *
 * Pure and Electron-free: the input shape is the four fields of `Electron.Input` that matter, so a
 * test can pose a keystroke without a window.
 */

/** What a shortcut asks the pane to do. */
export type ShortcutAction =
  | { kind: "new-tab" }
  | { kind: "close-tab" }
  | { kind: "focus-address" }
  | { kind: "reload" }
  | { kind: "go-back" }
  | { kind: "go-forward" }
  | { kind: "next-tab" }
  | { kind: "previous-tab" }
  /** Zero-based position in the tab strip. */
  | { kind: "select-tab"; index: number }
  | { kind: "select-last-tab" };

export interface ShortcutInput {
  /** `Electron.Input.key` — the printable character or named key. */
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  platform: NodeJS.Platform;
}

/**
 * Whether the platform's "browser accelerator" modifier — and only it — is held.
 *
 * Command on macOS, Control everywhere else. The other of the two must be *up*: Ctrl+T on macOS is
 * a terminal's transpose and Cmd+T on Linux is nothing at all, and claiming both spellings on both
 * platforms is how an app ends up eating a keystroke its host OS had already spoken for.
 */
function acceleratorOnly(input: ShortcutInput): boolean {
  const darwin = input.platform === "darwin";
  const accelerator = darwin ? input.meta : input.control;
  const other = darwin ? input.control : input.meta;
  return accelerator && !other && !input.alt;
}

/**
 * The keystroke → action table.
 *
 * Returns null for everything else, which is the common case: this runs on every keypress in the
 * window, including every character typed into the composer, and anything it does not claim must
 * pass through untouched.
 */
export function resolveShortcut(input: ShortcutInput): ShortcutAction | null {
  // Tab cycling is Control-based on every platform, macOS included — Cmd+Tab belongs to the OS
  // application switcher and must never be intercepted. This is the one binding that carries Shift
  // as part of its meaning, so it is matched before the "no Shift" rule below rather than
  // exempted from it.
  if (input.key === "Tab" && input.control && !input.meta && !input.alt) {
    return input.shift ? { kind: "previous-tab" } : { kind: "next-tab" };
  }

  if (!acceleratorOnly(input)) return null;
  // Nothing else in this table is a Shift binding. Claiming Shift combinations by accident is how a
  // shortcut table starts eating a site's own keyboard handling, so they are refused outright.
  if (input.shift) return null;

  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;

  switch (key) {
    case "t":
      return { kind: "new-tab" };
    case "w":
      return { kind: "close-tab" };
    case "l":
      return { kind: "focus-address" };
    case "r":
      return { kind: "reload" };
    // History, not tab order. Cmd+[ / Cmd+] are Back and Forward in Safari and Chrome, and a user
    // who reaches for them mid-booking means "the previous page", not "the previous tab" — sending
    // them to the tab strip would move the page out from under them.
    case "[":
      return { kind: "go-back" };
    case "]":
      return { kind: "go-forward" };
    default:
      break;
  }

  // Digits pick a tab by position, and 9 means "the last one" however many there are — the
  // behaviour every browser has, and the reason 9 is not simply index 8.
  if (key === "9") return { kind: "select-last-tab" };
  if (key >= "1" && key <= "8") return { kind: "select-tab", index: Number(key) - 1 };

  return null;
}

/**
 * Turns a position into a tab id, or null when nothing is there.
 *
 * Kept next to the table because the "9 is the last tab" rule only means anything against a
 * concrete strip, and resolving it in the caller would put half the rule in the key handler.
 */
export function tabIdForAction(
  action: ShortcutAction,
  tabIds: readonly string[],
  activeTabId: string | null,
): string | null {
  if (tabIds.length === 0) return null;
  // -1 for "no active tab", and for an active tab that is not in this strip (it belongs to another
  // conversation). Both are handled explicitly below rather than being clamped to 0: clamping made
  // "next" from nowhere land on the *second* tab, because it read the clamp as "we are on the
  // first".
  const currentIndex = activeTabId === null ? -1 : tabIds.indexOf(activeTabId);

  switch (action.kind) {
    case "select-tab":
      return tabIds[action.index] ?? null;
    case "select-last-tab":
      return tabIds[tabIds.length - 1] ?? null;
    case "next-tab":
      // Wraps, like every tab strip. With one tab this returns that tab, which is a no-op rather
      // than a special case. With no current tab, "next" is the first.
      if (currentIndex < 0) return tabIds[0] ?? null;
      return tabIds[(currentIndex + 1) % tabIds.length] ?? null;
    case "previous-tab":
      // And "previous" from nowhere is the last, which is where wrapping backwards from the start
      // would have put it anyway.
      if (currentIndex < 0) return tabIds[tabIds.length - 1] ?? null;
      return tabIds[(currentIndex + tabIds.length - 1) % tabIds.length] ?? null;
    default:
      return activeTabId;
  }
}
