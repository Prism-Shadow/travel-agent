/**
 * Wiring the browser's keyboard shortcuts to the pane, on both focus paths.
 *
 * The table that decides *what* a keystroke means is `browser-shortcuts.ts`, and it is pure. This
 * is the part that needs Electron: attaching to a `webContents`, deciding whether the pane is
 * entitled to the key at all, and performing the action.
 *
 * Two things make main the right place for it rather than the renderer:
 *
 *  1. **Focus can be inside a page.** A `WebContentsView` is a separate `webContents` with its own
 *     input stream, so a renderer-side `keydown` listener never sees a keystroke typed into a
 *     booking site. `before-input-event` on each view does.
 *  2. **Menu accelerators.** `menu.ts` keeps the standard `viewMenu` and `windowMenu` roles, which
 *     own Cmd+R and Cmd+W. Electron documents `preventDefault()` on `before-input-event` as
 *     suppressing menu shortcuts as well as the page's key events, so claiming a key here beats the
 *     menu without rebuilding it — and *not* claiming it leaves the menu working exactly as before.
 */
import type { WebContents } from "electron";
import type { BrowserPane } from "./browser-pane.js";
import { resolveShortcut, tabIdForAction } from "./browser-shortcuts.js";
import type { ShortcutAction } from "./browser-shortcuts.js";

/** Electron's `Input`, narrowed to the fields the table reads. */
interface ElectronInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  isAutoRepeat?: boolean;
}

/**
 * Performs a shortcut. Returns whether the pane actually took it.
 *
 * Returning false rather than throwing on an unusable action matters: the caller only suppresses
 * the keystroke when this says yes, so a Cmd+W with no tab to close still closes the window rather
 * than doing nothing at all.
 */
export function performShortcut(action: ShortcutAction, pane: BrowserPane): boolean {
  const state = pane.state();
  const tabIds = state.tabs.map((tab) => tab.id);
  const activeTabId = state.activeTabId;

  try {
    switch (action.kind) {
      case "new-tab":
        pane.openTabForUser();
        return true;
      case "close-tab":
        if (!activeTabId) return false;
        pane.closeTab(activeTabId);
        return true;
      case "reload":
        if (!activeTabId) return false;
        pane.reload(activeTabId);
        return true;
      case "go-back":
        if (!activeTabId) return false;
        pane.goBack(activeTabId);
        return true;
      case "go-forward":
        if (!activeTabId) return false;
        pane.goForward(activeTabId);
        return true;
      case "focus-address":
        // Handled by the caller, which owns the channel to the renderer.
        return true;
      default: {
        const target = tabIdForAction(action, tabIds, activeTabId);
        // A digit that names a tab which is not there is not an error and not a fallback either:
        // Cmd+5 in a three-tab strip does nothing in every browser.
        if (!target || target === activeTabId) return target !== null;
        pane.selectTab(target);
        return true;
      }
    }
  } catch {
    // Every pane operation refuses ids outside the current conversation. Reaching that from a
    // keystroke means the strip changed under the user's fingers; leaving the key unclaimed is
    // better than swallowing it.
    return false;
  }
}

export interface ShortcutRouterOptions {
  pane: BrowserPane;
  /** Asks the renderer to focus the address bar (Cmd+L). Main cannot focus a DOM element itself. */
  focusAddressBar: () => void;
}

/**
 * Attaches the router to one `webContents`.
 *
 * Called for the app window and for every view the pane builds, including the ones a crash rebuilds
 * — a shortcut that stopped working after a tab crashed would be a strange kind of recovery.
 */
export function attachShortcutRouter(contents: WebContents, options: ShortcutRouterOptions): void {
  contents.on("before-input-event", (event, rawInput) => {
    const input = rawInput as unknown as ElectronInput;
    // keyUp would fire the action a second time, and an auto-repeat would fire it many more —
    // Cmd+W held down would close every tab in the strip.
    if (input.type !== "keyDown" || input.isAutoRepeat === true) return;
    // Asked before the table, not after: with the pane closed these keys belong to the window, and
    // resolving them first would mean deciding twice what "Cmd+W" means.
    if (!options.pane.acceptsShortcuts()) return;

    const action = resolveShortcut({
      key: input.key,
      control: input.control,
      meta: input.meta,
      shift: input.shift,
      alt: input.alt,
      platform: process.platform,
    });
    if (!action) return;

    if (action.kind === "focus-address") {
      options.focusAddressBar();
      event.preventDefault();
      return;
    }
    if (performShortcut(action, options.pane)) event.preventDefault();
  });
}
