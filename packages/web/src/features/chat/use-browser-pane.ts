/**
 * State for the in-app browser pane: whether it is open, how wide it is, and where its viewport
 * sits on screen.
 *
 * The pane is not a DOM node. What the renderer owns is a *hole* — a placeholder div that reserves
 * space in the flex layout — and this hook keeps the main process told where that hole is, so the
 * real `WebContentsView` lands exactly on top of it.
 *
 * **Main owns whether the pane is open.** Either side may ask — the user by clicking the toggle,
 * the agent by opening a tab — but only main decides, and the renderer renders whatever comes back
 * in `requested`. That is what keeps this loop-free: the renderer never derives `open` from its own
 * state, so an agent-opened pane and a user-opened one travel the same path.
 *
 * Measurement runs on a `ResizeObserver` plus window resize and scroll, coalesced to an animation
 * frame. Reporting per observer callback would send a message per pointer move during a drag.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import type { DesktopPaneState } from "../../lib/desktop-bridge";
import {
  DEFAULT_PANE_FRACTION,
  canSplit,
  clampPaneFraction,
  fractionFromKey,
  fractionFromPointer,
} from "./browser-pane-split";

const EMPTY_STATE: DesktopPaneState = {
  present: false,
  visible: false,
  url: "",
  title: "",
  loading: false,
  requested: false,
};

const FRACTION_STORAGE_KEY = "penguin.iabPaneFraction";

function storedFraction(): number {
  if (typeof window === "undefined") return DEFAULT_PANE_FRACTION;
  try {
    // Reading can throw, not just writing: a browser in a blocked-cookies or restricted-storage
    // mode raises SecurityError on access, and letting that escape would break the whole hook.
    const raw = window.localStorage?.getItem(FRACTION_STORAGE_KEY);
    const parsed = raw === null || raw === undefined ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : DEFAULT_PANE_FRACTION;
  } catch {
    return DEFAULT_PANE_FRACTION;
  }
}

export interface BrowserPaneState {
  /** True only in the desktop shell with the flag on. The pane is not rendered at all when false. */
  supported: boolean;
  /** Whether the pane is showing. Mirrors main's `requested`, never the renderer's own guess. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Whether the window is wide enough for both columns. Below this the pane cannot be shown. */
  splittable: boolean;
  /** Fraction of the split area given to the browser. */
  fraction: number;
  /** Attach to the element that contains both columns; used to convert pointer x into a fraction. */
  containerRef: (node: HTMLElement | null) => void;
  /** Attach to the placeholder element whose position the view should track. */
  measureRef: (node: HTMLElement | null) => void;
  /** Pointer-down on the divider. */
  onSplitterPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Keyboard on the divider. */
  onSplitterKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  dragging: boolean;
  /** What the view is doing, pushed from the main process. */
  pane: DesktopPaneState;
}

export function useBrowserPane(): BrowserPaneState {
  const bridge = desktopBrowserBridge();
  const supported = bridge !== null;
  const [pane, setPane] = useState<DesktopPaneState>(EMPTY_STATE);
  const [fraction, setFraction] = useState<number>(storedFraction);
  const [dragging, setDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  const containerNode = useRef<HTMLElement | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastSent = useRef<string>("");

  /**
   * Tells main there is no hole any more.
   *
   * Sent whenever the placeholder goes away — the pane closes, the window becomes too narrow to
   * split, the component unmounts, the route changes. Without it main keeps the last rectangle it
   * was given and the view stays parked on top of the conversation; a later reopen would also flash
   * at the stale bounds before the first fresh measurement arrives.
   */
  const clearBounds = useCallback(() => {
    if (!bridge) return;
    lastSent.current = "none";
    void bridge.setBounds(null).catch(() => {});
  }, [bridge]);

  const report = useCallback(() => {
    if (!bridge) return;
    frameRef.current = null;
    const node = nodeRef.current;
    if (!node) {
      clearBounds();
      return;
    }
    const rect = node.getBoundingClientRect();
    const next = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    // Skip identical reports: a ResizeObserver fires for changes that do not move the box, and main
    // would otherwise recompute and re-set identical bounds.
    const signature = `${next.x},${next.y},${next.width},${next.height}`;
    if (signature === lastSent.current) return;
    lastSent.current = signature;
    void bridge.setBounds(next).catch(() => {
      // The window may be closing; a dropped measurement is not worth surfacing.
    });
  }, [bridge, clearBounds]);

  const scheduleReport = useCallback(() => {
    if (!bridge || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(report);
  }, [bridge, report]);

  const measureRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      if (node) {
        scheduleReport();
      } else {
        // React calls this with null on unmount and on a route change. The hole is gone, so say so
        // immediately rather than waiting for a frame that may never be scheduled.
        clearBounds();
      }
    },
    [scheduleReport, clearBounds],
  );

  const containerRef = useCallback((node: HTMLElement | null) => {
    containerNode.current = node;
    if (node) setContainerWidth(node.getBoundingClientRect().width);
  }, []);

  // Keep the reported rectangle and the container width current: the element resizing, the window
  // resizing, and the page scrolling all move the hole relative to the window.
  useEffect(() => {
    if (!bridge) return;
    const syncWidth = (): void => {
      const node = containerNode.current;
      if (node) setContainerWidth(node.getBoundingClientRect().width);
    };
    const onChange = (): void => {
      syncWidth();
      scheduleReport();
    };
    const observer = new ResizeObserver(onChange);
    if (nodeRef.current) observer.observe(nodeRef.current);
    if (containerNode.current) observer.observe(containerNode.current);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    syncWidth();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [bridge, scheduleReport, pane.requested]);

  // The pane closing, or the window becoming too narrow to split, both remove the hole without
  // unmounting anything React would tell us about.
  useEffect(() => {
    if (!pane.requested || !canSplit(containerWidth)) clearBounds();
  }, [pane.requested, containerWidth, clearBounds]);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    // Catch as well as guard: the window can close, or the IPC handlers can be torn down, between
    // the call and its answer, and an uncaught rejection there would surface as a console error
    // during ordinary shutdown.
    void bridge
      .getState()
      .then((state) => {
        if (!cancelled) setPane(state);
      })
      .catch(() => {
        // Nothing to show; the state stream below will deliver one if the bridge comes back.
      });
    const unsubscribe = bridge.onState(setPane);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!bridge) return;
      // No local open state: main answers with `requested` and the render follows that. Setting it
      // here too would give two sources for one fact and let them disagree.
      void bridge.setOpen(next).catch(() => {});
      if (next) requestAnimationFrame(() => scheduleReport());
    },
    [bridge, scheduleReport],
  );

  // A pane that just became visible has not been measured at its new size yet.
  useEffect(() => {
    if (!pane.requested) return;
    scheduleReport();
  }, [pane.requested, fraction, scheduleReport]);

  const applyFraction = useCallback((next: number) => {
    setFraction(next);
    try {
      window.localStorage?.setItem(FRACTION_STORAGE_KEY, String(next));
    } catch {
      // Private mode or a full quota; the width simply does not persist.
    }
  }, []);

  // One drag at a time. A second pointerdown before the first released — a stray touch, a mouse
  // button pressed mid-drag, a pointer lost to another element — would otherwise leave the first
  // drag's window listeners attached forever, each still moving the splitter.
  const dragCleanup = useRef<(() => void) | null>(null);

  const endDrag = useCallback(() => {
    dragCleanup.current?.();
    dragCleanup.current = null;
    setDragging(false);
    // The view is shown again only after the drag ends; see the occlusion note below.
    if (bridge) void bridge.setOccluded(false).catch(() => {});
  }, [bridge]);

  const onSplitterPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const container = containerNode.current;
      if (!container) return;
      event.preventDefault();
      endDrag();

      const target = event.currentTarget;
      const { pointerId } = event;
      try {
        target.setPointerCapture?.(pointerId);
      } catch {
        // Some pointer types refuse capture; the window listeners below still track the drag.
      }
      setDragging(true);

      // Hide the view for the duration. A WebContentsView is a native surface above the DOM, so it
      // swallows pointer events that cross it — without this a drag that moves past the divider
      // stops dead the moment the cursor enters the browser half.
      if (bridge) void bridge.setOccluded(true).catch(() => {});

      const box = container.getBoundingClientRect();
      const move = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return;
        applyFraction(fractionFromPointer(moveEvent.clientX, box.left, box.width));
      };
      const finish = (endEvent?: PointerEvent): void => {
        if (endEvent && endEvent.pointerId !== pointerId) return;
        endDrag();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      // Capture can be taken away — another element grabs it, the pointer leaves the window — and
      // no pointerup follows. Without this the drag would never end.
      target.addEventListener("lostpointercapture", finish as EventListener);

      dragCleanup.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        target.removeEventListener("lostpointercapture", finish as EventListener);
        try {
          if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
        } catch {
          // Already released, or the element is gone.
        }
      };
    },
    [applyFraction, bridge, endDrag],
  );

  // A drag in progress when the component goes away would leave window listeners behind.
  useEffect(() => endDrag, [endDrag]);

  const onSplitterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const next = fractionFromKey(event.key, fraction, containerWidth);
      if (next === null) return;
      event.preventDefault();
      applyFraction(next);
    },
    [applyFraction, fraction, containerWidth],
  );

  const splittable = canSplit(containerWidth);
  const clamped = clampPaneFraction(fraction, containerWidth);

  return {
    supported,
    open: pane.requested,
    setOpen,
    splittable,
    fraction: clamped,
    containerRef,
    measureRef,
    onSplitterPointerDown,
    onSplitterKeyDown,
    dragging,
    pane,
  };
}
