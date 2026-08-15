/**
 * The right-hand browser column and the splitter that sizes it.
 *
 * Almost everything visible here is a frame around an emptiness. The actual page is a
 * `WebContentsView` that the main process paints *over* the placeholder div below — it is not in
 * this tree, cannot be styled from here, and renders above every DOM element regardless of
 * z-index. What this component owns is the status strip, the divider, and a correctly sized hole.
 *
 * Phase 1 scope: one view, a status strip, and a splitter. Tab strip, address bar and navigation
 * controls belong to Phase 2 (design/004); shipping disabled versions of them now would be
 * inventory rather than progress.
 */
import { S } from "../../lib/strings";
import { ariaValueNow, MAX_PANE_FRACTION, MIN_PANE_FRACTION } from "./browser-pane-split";
import type { BrowserPaneState } from "./use-browser-pane";

function statusLabel(pane: BrowserPaneState["pane"]): string {
  if (!pane.present) return S.chat.browserPane.starting;
  if (pane.loading) return S.chat.browserPane.loading;
  return pane.title || S.chat.browserPane.ready;
}

/** Shows the origin rather than the whole URL: it is what tells the user where they are. */
function originOf(url: string): string {
  if (!url || url === "about:blank") return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The divider.
 *
 * A real `separator` with `aria-orientation="vertical"`, focusable, and driven by the arrow keys as
 * well as the pointer — a control that can only be dragged is unusable without a mouse, and this
 * one decides how much of the window each half gets.
 */
export function BrowserPaneSplitter({ state }: { state: BrowserPaneState }): React.ReactElement {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={S.chat.browserPane.resize}
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round(MAX_PANE_FRACTION * 100)}
      aria-valuenow={ariaValueNow(state.fraction)}
      tabIndex={0}
      data-testid="iab-splitter"
      onPointerDown={state.onSplitterPointerDown}
      onKeyDown={state.onSplitterKeyDown}
      className={`group relative w-1 shrink-0 cursor-col-resize touch-none select-none outline-none ${
        state.dragging ? "bg-blue-400 dark:bg-blue-500" : "bg-gray-200 dark:bg-gray-800"
      } hover:bg-blue-400 focus-visible:bg-blue-500 dark:hover:bg-blue-500`}
    >
      {/* A 1px divider is too small to grab; this widens the hit area without widening the line. */}
      <span aria-hidden="true" className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}

export function BrowserPanePanel({ state }: { state: BrowserPaneState }): React.ReactElement {
  const { pane, measureRef } = state;
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 text-xs dark:border-gray-800">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            pane.loading
              ? "bg-amber-500"
              : pane.present
                ? "bg-emerald-500"
                : "bg-gray-300 dark:bg-gray-700"
          }`}
          aria-hidden="true"
        />
        <span className="truncate font-medium text-gray-700 dark:text-gray-200">
          {statusLabel(pane)}
        </span>
        <span className="ml-auto truncate font-mono text-gray-400 dark:text-gray-500">
          {originOf(pane.url)}
        </span>
      </div>

      {/*
        The hole. The view is positioned over this element's bounding box by the main process, so it
        must reserve real space and must not be given a background that would flash through during a
        resize. Nothing may be rendered inside it: a WebContentsView paints above the DOM, so any
        child would simply be invisible.
      */}
      <div ref={measureRef} className="min-h-0 flex-1" data-testid="iab-viewport" />
    </div>
  );
}
