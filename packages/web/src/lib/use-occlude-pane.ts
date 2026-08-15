/**
 * The hook every overlay uses to get the in-app browser out of its way.
 *
 * One line in each of them — `useOccludePane(open)` for something that covers the window,
 * `useOccludePane(open, ref)` for a floating panel that only sometimes overlaps. See
 * `pane-occlusion.ts` for why this exists at all; the short version is that a `WebContentsView`
 * paints above the DOM and cannot be covered by anything the page draws.
 *
 * Registration is unconditional and free outside the desktop shell: in a browser tab nothing is
 * subscribed to the registry, so the entries accumulate and disappear with nobody reading them.
 * That is what keeps the shared UI components free of "am I in Electron" branches.
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { notifyOcclusionChanged, occludePane } from "./pane-occlusion";
import type { OcclusionRect } from "./pane-occlusion";

/**
 * Declares that something is drawn over the page while `active`.
 *
 * `element` narrows the claim to that element's rectangle; without it the overlay is treated as
 * covering the window, which is what a modal, a drawer and a sheet all do.
 */
export function useOccludePane(active: boolean, element?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;

    // An overlay that is already open can move or change size without anything else noticing — a
    // toast stack gaining a second toast is the everyday case. The registry only fires when an
    // entry is added or removed, and the pane watches its own box, not this one, so the element is
    // observed here and the verdict is recomputed when it changes.
    const node = element?.current ?? null;
    let observer: ResizeObserver | null = null;
    if (node && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => notifyOcclusionChanged());
      observer.observe(node);
    }

    const release = occludePane(() => {
      if (!element) return null;
      const node = element.current;
      // No node yet means the panel is mid-mount. Reporting null — "assume it covers everything" —
      // is the safe direction: one frame of a hidden view beats one frame of a native surface
      // eating the click that was meant for the menu.
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      } satisfies OcclusionRect;
    });

    return () => {
      observer?.disconnect();
      release();
    };
  }, [active, element]);
}
