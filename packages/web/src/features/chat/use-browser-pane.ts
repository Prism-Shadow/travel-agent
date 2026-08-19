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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import type {
  DesktopBackend,
  DesktopPageCapture,
  DesktopPaneState,
  DesktopTabState,
} from "../../lib/desktop-bridge";
import { computeOcclusion, occludePane, subscribeToOcclusion } from "../../lib/pane-occlusion";
import { occlusionEntries } from "../../lib/pane-occlusion";
import { applySessionSwitch, isCurrentAnswer, isScopeSettled } from "./browser-pane-scope";
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
  requested: false,
  tabs: [],
  activeTabId: null,
  sessionScope: null,
  backend: "iab",
  backendLocked: false,
  extensionBackendAvailable: true,
  profileResetLocked: false,
  restorable: 0,
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
  /** Everything the chrome draws: tabs, selection, backend, the crash prompt's count. */
  tabs: DesktopPaneState["tabs"];
  activeTabId: string | null;
  activeTab: DesktopTabState | null;
  restorable: number;
  backend: DesktopBackend;
  /** Whether the backend choice is held shut by a running task. */
  backendLocked: boolean;
  /** False when this run's relay is not one a Chrome extension can reach. */
  extensionBackendAvailable: boolean;
  /** Whether clearing the browser data is held shut by a running task. */
  profileResetLocked: boolean;
  /** Tab and navigation actions, each a thin pass-through to main. */
  actions: BrowserPaneActions;
  /** Ref for the address input, so Cmd+L can focus it. */
  addressRef: React.RefObject<HTMLInputElement | null>;
  /**
   * Whether main has confirmed it is showing the conversation the renderer is on.
   *
   * False for the width of a conversation switch. The chrome renders, but with no tabs and with the
   * native view hidden — the alternative is a frame of one conversation's pages inside another.
   */
  scopeSettled: boolean;
  /** Whether the pane is showing. Mirrors main's `requested`, never the renderer's own guess. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Whether the window is wide enough for both columns side by side. */
  splittable: boolean;
  /**
   * The pane is open but the window is too narrow to split, so the browser takes the whole area.
   *
   * Design/002 §6.2's third visibility state, and the reason it is not optional: without it a
   * narrow window left the pane "open" with nowhere to draw it — main was told the hole was gone,
   * the toggle disappeared, and the agent went on driving a browser nobody could see or close.
   */
  fullscreen: boolean;
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
  /** Frozen frame of the page, shown in the hole while a splitter drag hides the native view. */
  dragPreview: DesktopPageCapture | null;
  /** What the view is doing, pushed from the main process. */
  pane: DesktopPaneState;
}

/** What the chrome can ask main to do. Every one of them is refused for a tab outside the strip. */
export interface BrowserPaneActions {
  /** Promote this draft's whole browser strip to the Session created by its first send. */
  reassignSession: (sessionId: string) => Promise<void>;
  /** Opens a blank tab, or opens the supplied address as the first tab in an empty strip. */
  openTab: (url?: string) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  selectTab: (tabId: string) => Promise<void>;
  setRetain: (tabId: string, retain: boolean) => void;
  setZoom: (tabId: string, factor: number) => Promise<void>;
  /** Captures the visible IAB viewport before a DOM menu hides the native surface. */
  captureActivePage: () => Promise<DesktopPageCapture | null>;
  navigate: (tabId: string, url: string) => Promise<void>;
  goBack: (tabId: string) => void;
  goForward: (tabId: string) => void;
  reload: (tabId: string) => void;
  stop: (tabId: string) => void;
  restore: (accept: boolean) => Promise<void>;
  clearProfile: () => Promise<void>;
  setBackend: (backend: DesktopBackend) => Promise<void>;
  /**
   * Opens the current page in whatever browser the operating system hands URLs to.
   *
   * Named for what it does. It is *not* the backend handoff: the browser that opens may not be the
   * one the extension is connected to, and nothing of the in-app session travels with it. It is a
   * convenience for a user who wants the page in their own browser; the real handoff is choosing
   * the extension backend for the conversation, which is what makes the next agent session run
   * there (design/002 §7.2).
   */
  openInDefaultBrowser: () => Promise<boolean>;
}

/**
 * @param sessionId the browser scope on screen: a real Session or a persisted draft scope. Main
 * shows only this scope's tabs; `null` shows none, because every tab belongs to exactly one scope.
 */
export function useBrowserPane(sessionId: string | null): BrowserPaneState {
  const bridge = desktopBrowserBridge();
  const supported = bridge !== null;
  /**
   * The conversation main has confirmed it is showing.
   *
   * Null until the round trip lands. Everything the strip exposes is gated on this agreeing with
   * the conversation the renderer is on, so a frame painted for B can never carry A's tabs.
   */
  const [confirmedScope, setConfirmedScope] = useState<string | null>(null);
  const [pane, setPane] = useState<DesktopPaneState>(EMPTY_STATE);
  const [fraction, setFraction] = useState<number>(storedFraction);
  const [dragging, setDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<DesktopPageCapture | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const containerNode = useRef<HTMLElement | null>(null);
  /** Current requested scope, so an async send from a draft already navigated away from cannot win. */
  const requestedScopeRef = useRef(sessionId);
  requestedScopeRef.current = sessionId;
  /** Read by the measurement callback, which must not close over a stale render's verdict. */
  const scopeSettledRef = useRef(false);
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
    // No hole while a switch is in flight: the view must not paint anywhere until main has
    // confirmed which conversation it is showing.
    if (!node || !scopeSettledRef.current) {
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
    if (!pane.requested) clearBounds();
  }, [pane.requested, clearBounds]);

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

  /** Registration held for the duration of a splitter drag; see the note in onSplitterPointerDown. */
  const dragOcclusion = useRef<(() => void) | null>(null);
  /** Bumped when a drag ends, so its in-flight capture/occlusion callbacks know to stand down. */
  const dragToken = useRef(0);
  const dragPreviewClear = useRef<number | null>(null);

  const endDrag = useCallback(() => {
    dragToken.current += 1;
    dragCleanup.current?.();
    dragCleanup.current = null;
    setDragging(false);
    dragOcclusion.current?.();
    dragOcclusion.current = null;
    // Keep the frozen frame for a beat while the native surface comes back — the same grace the
    // Browser menu preview takes — so the hole never blanks between the image and the live page.
    if (dragPreviewClear.current !== null) window.clearTimeout(dragPreviewClear.current);
    dragPreviewClear.current = window.setTimeout(() => {
      dragPreviewClear.current = null;
      setDragPreview(null);
    }, 120);
  }, []);

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
      // stops dead the moment the cursor enters the browser half. Registered through the same
      // reference-counted store the overlays use, so a drag started while a modal is up does not
      // un-hide the view when it ends.
      //
      // Hiding alone leaves the hole blank for the whole drag, so first freeze the page the way
      // the Browser menu does. The order is capture → occlude — capture refuses once the view is
      // already hidden — and the cursor starts on the divider, not over the native surface, so
      // occlusion may lag by the capture's latency (capped below) without losing the drag.
      const token = dragToken.current;
      if (dragPreviewClear.current !== null) {
        window.clearTimeout(dragPreviewClear.current);
        dragPreviewClear.current = null;
      }
      const capture = bridge
        ? bridge.captureActivePage().catch(() => null)
        : Promise.resolve(null);
      void capture.then((captured) => {
        if (token === dragToken.current && captured !== null) setDragPreview(captured);
      });
      // Occlude when the capture settles or after 80ms, whichever is first: a slow capture must
      // not leave the native surface swallowing pointer events once the cursor reaches it.
      const occludeCap = new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 80);
      });
      void Promise.race([capture, occludeCap]).then(() => {
        if (token !== dragToken.current || dragOcclusion.current !== null) return;
        dragOcclusion.current = occludePane(() => null);
      });

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

  // A drag in progress when the component goes away would leave window listeners behind, and the
  // preview-clear timer would set state on an unmounted component.
  useEffect(
    () => () => {
      endDrag();
      if (dragPreviewClear.current !== null) window.clearTimeout(dragPreviewClear.current);
    },
    [endDrag],
  );

  const onSplitterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const next = fractionFromKey(event.key, fraction, containerWidth);
      if (next === null) return;
      event.preventDefault();
      applyFraction(next);
    },
    [applyFraction, fraction, containerWidth],
  );

  // Which conversation main should show tabs for. Sent on every change, including to null when the
  // user is on the session list: a tab belongs to one conversation, and no other may display it.
  //
  // The bounds are cleared *first*. Main is told the hole is gone before it is told which
  // conversation this is, so the native view is off screen for the whole switch rather than showing
  // the previous conversation's page over the new one's chat while the round trip is in flight.
  //
  // Answers are matched to requests by a counter: two route changes in quick succession can settle
  // out of order, and a late answer for the conversation the user has already left must not be
  // taken as confirmation of the one they are in.
  const switchRequest = useRef(0);
  // A layout effect, not an effect: this runs in the commit that changed the route, before the
  // browser paints it. An ordinary effect fires *after* the new conversation is on screen, which is
  // one frame of the previous conversation's page sitting over it.
  useLayoutEffect(() => {
    if (!bridge) return;
    const request = ++switchRequest.current;
    setConfirmedScope(null);
    void applySessionSwitch({
      hide: () => bridge.hideNow(),
      announce: (id) => bridge.setSession(id),
      sessionId,
      isCurrent: () => isCurrentAnswer(request, switchRequest.current),
      onHidden: () => {
        lastSent.current = "none";
      },
    }).then((scope) => {
      if (!isCurrentAnswer(request, switchRequest.current)) return;
      setConfirmedScope(scope);
    });
  }, [bridge, sessionId]);

  // Overlay occlusion. Every portal and full-screen overlay registers with the shared store; this
  // is the only subscriber, and it decides by intersecting each one against the pane's own
  // rectangle — so a dropdown in the left column never blinks the browser, and a modal always does.
  useEffect(() => {
    if (!bridge) return;
    let last: boolean | null = null;
    const evaluate = (): void => {
      const node = nodeRef.current;
      const rect = node?.getBoundingClientRect();
      const paneRect =
        rect && pane.requested
          ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
          : null;
      const occluded = computeOcclusion(occlusionEntries(), paneRect);
      if (occluded === last) return;
      last = occluded;
      void bridge.setOccluded(occluded).catch(() => {});
    };
    // Membership is not the only thing that changes the answer: the pane moves when the splitter is
    // dragged or the window resizes, and a floating panel moves when the page scrolls under it. An
    // overlay that stopped overlapping — or started — without either set changing would otherwise
    // leave the view hidden, or leave it swallowing the clicks meant for a menu.
    const schedule = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        evaluate();
      });
    };
    let frame: number | null = null;
    const observer = new ResizeObserver(schedule);
    if (nodeRef.current) observer.observe(nodeRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    evaluate();
    const unsubscribe = subscribeToOcclusion(evaluate);
    return () => {
      unsubscribe();
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [bridge, pane.requested]);

  // Cmd/Ctrl+L. The shortcut table lives in main because focus can be inside a page, where the
  // renderer sees no keystrokes at all; focusing an input is the one part main cannot do.
  const addressRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!bridge) return;
    return bridge.onFocusAddress(() => {
      const input = addressRef.current;
      input?.focus();
      input?.select();
    });
  }, [bridge]);

  const actions = useMemo<BrowserPaneActions>(() => {
    // Every one of these can legitimately reject — the tab may have closed, or the conversation
    // changed, between the render that drew the control and the click on it. That is not worth
    // surfacing: the state push that follows already tells the renderer what is really there.
    const quiet = (work: Promise<unknown> | undefined): void => {
      void work?.catch(() => {});
    };
    return {
      reassignSession: async (nextSessionId) => {
        if (requestedScopeRef.current !== sessionId) {
          throw new Error("The draft browser scope is no longer active");
        }
        // A very fast first send can beat the layout effect's initial set-session round trip. Make
        // the draft scope current before promoting it; on rollback `nextSessionId === sessionId`,
        // so deliberately skip this confirmation — setting the draft normally would clear main's
        // one-shot rollback record before it can move the tabs back.
        if (bridge && sessionId !== null && nextSessionId !== sessionId) {
          const confirmed = await bridge.setSession(sessionId);
          if (confirmed !== sessionId) {
            throw new Error("The draft browser scope was not ready to be promoted");
          }
        }
        if (requestedScopeRef.current !== sessionId) {
          throw new Error("The draft browser scope is no longer active");
        }
        await bridge?.reassignSession(nextSessionId);
      },
      // Awaited by the address bar, which uses a submitted URL to create the first tab in an empty
      // strip. The plus button may still deliberately ignore a stale-conversation rejection.
      openTab: async (url) => {
        await bridge?.openTab(url);
      },
      // Awaited too: closing from the keyboard has to move focus to whatever is selected next.
      closeTab: async (tabId) => {
        await bridge?.closeTab(tabId);
      },
      // Awaited by the tab strip, which moves focus only once main confirms the selection landed.
      selectTab: async (tabId) => {
        await bridge?.selectTab(tabId);
      },
      setRetain: (tabId, retain) => quiet(bridge?.setRetain(tabId, retain)),
      setZoom: async (tabId, factor) => {
        await bridge?.setZoom(tabId, factor);
      },
      captureActivePage: async () => (await bridge?.captureActivePage()) ?? null,
      navigate: async (tabId, url) => {
        await bridge?.navigate(tabId, url);
      },
      goBack: (tabId) => quiet(bridge?.goBack(tabId)),
      goForward: (tabId) => quiet(bridge?.goForward(tabId)),
      reload: (tabId) => quiet(bridge?.reload(tabId)),
      stop: (tabId) => quiet(bridge?.stop(tabId)),
      // Not quiet: restoring can fail — a view that will not build — and the offer is deliberately
      // kept when it does, so the user has something to retry. Swallowing the rejection would show
      // a prompt that answers to nothing.
      restore: async (accept) => {
        await bridge?.restore(accept);
      },
      clearProfile: async () => {
        await bridge?.clearProfile();
      },
      // Not quiet: main refuses this for reasons the user can act on, and a control that silently
      // does nothing is worse than one that says why.
      setBackend: async (backend) => {
        await bridge?.setBackend(backend);
      },
      openInDefaultBrowser: async () => (await bridge?.handoffOpen()) ?? false,
    };
  }, [bridge, sessionId]);

  const splittable = canSplit(containerWidth);
  const clamped = clampPaneFraction(fraction, containerWidth);
  const fullscreen = supported && pane.requested && containerWidth > 0 && !splittable;
  /**
   * Whether what main is publishing is about the conversation on screen.
   *
   * Both halves have to agree: main's own `sessionScope`, and the confirmation of *our* switch.
   * A state push can arrive between the route change and main hearing about it, and it would carry
   * the previous conversation's tabs with the previous conversation's scope.
   */
  const scopeSettled = isScopeSettled({
    requested: sessionId,
    confirmed: confirmedScope,
    published: pane.sessionScope,
  });
  // Kept in a ref for the measurement callback, which must not close over a stale render's verdict,
  // and re-reported the moment it becomes true.
  scopeSettledRef.current = scopeSettled;
  const tabs = scopeSettled ? pane.tabs : [];
  const activeTabId = scopeSettled ? pane.activeTabId : null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  useEffect(() => {
    if (scopeSettled) scheduleReport();
    else clearBounds();
  }, [scopeSettled, scheduleReport, clearBounds]);

  return {
    supported,
    open: pane.requested,
    setOpen,
    splittable,
    fullscreen,
    fraction: clamped,
    containerRef,
    measureRef,
    onSplitterPointerDown,
    onSplitterKeyDown,
    dragging,
    dragPreview,
    pane,
    tabs,
    activeTabId,
    activeTab,
    scopeSettled,
    restorable: pane.restorable,
    backend: pane.backend,
    backendLocked: pane.backendLocked,
    extensionBackendAvailable: pane.extensionBackendAvailable,
    profileResetLocked: pane.profileResetLocked,
    actions,
    addressRef,
  };
}

/**
 * Tells main that the set of running turns may have changed.
 *
 * A free function rather than part of the hook: the signal arrives on the session stream, which the
 * chat page owns. It is only ever a prompt — the authority is main's, precisely because this stream
 * is not there when the user is looking at another conversation.
 */
export function reportTasksChanged(): void {
  // A hint and nothing more. Main owns which turns are running — it asks the server, because this
  // stream is disposed the moment the user opens another conversation — so all this does is bring
  // that question forward by a poll interval.
  const bridge = desktopBrowserBridge();
  void bridge?.tasksChanged().catch(() => {
    // The window may be closing. Main's loop asks again on its own schedule regardless, which is
    // the whole reason a dropped hint costs nothing.
  });
}
