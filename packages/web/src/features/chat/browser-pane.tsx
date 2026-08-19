/**
 * The right-hand browser column: its chrome, and the splitter that sizes it.
 *
 * Almost everything visible here is a frame around an emptiness. The actual pages are
 * `WebContentsView`s that the main process paints *over* the placeholder div below — they are not
 * in this tree, cannot be styled from here, and render above every DOM element regardless of
 * z-index. What this component owns is the tab strip, the address bar, the navigation controls, the
 * divider, and a correctly sized hole.
 *
 * The chrome is drawn by us rather than being Chromium's (design/002 §2.1), which means the
 * accessibility is ours to get right too: a real `tablist` with roving focus, a real form for the
 * address bar, real button labels. A self-drawn tab strip that a screen reader reads as a row of
 * anonymous buttons would be a regression against the browser it replaces.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsThreeVertical";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/csr/GlobeSimple";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RadioButtonIcon } from "@phosphor-icons/react/dist/csr/RadioButton";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import {
  chosenUrl,
  close,
  EMPTY_SUGGESTIONS,
  move,
  receive,
  SUGGEST_DEBOUNCE_MS,
  suggestionLabel,
} from "./address-suggestions";
import type { SuggestionState } from "./address-suggestions";
import { BrowserImportDialog } from "./browser-import-dialog";
import { LoginOfferBar } from "./login-offer-bar";
import { ariaValueNow, MAX_PANE_FRACTION, MIN_PANE_FRACTION } from "./browser-pane-split";
import { displayUrl, normalizeUrlInput, originOf } from "./browser-url";
import { formatBrowserZoom, stepBrowserZoom } from "./browser-zoom";
import { createRovingFocus, pointerTabAction } from "./tab-focus";
import type { BrowserPaneState } from "./use-browser-pane";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import type { DesktopPageCapture, DesktopTabState } from "../../lib/desktop-bridge";

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

/**
 * The message to show for a rejected bridge call.
 *
 * Main's errors are written for a person — "A task is running…", "This conversation is set to use
 * your own Chrome" — so they are shown as they are. An IPC rejection arrives with Electron's own
 * `Error invoking remote method` prefix around them, which is stripped rather than shown.
 */
function messageOf(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const stripped = raw.replace(/^Error invoking remote method '[^']*':\s*/, "").trim();
  const withoutClass = stripped.replace(/^Error:\s*/, "").trim();
  return withoutClass === "" ? fallback : withoutClass;
}

function tabLabel(tab: DesktopTabState): string {
  return tab.title || originOf(tab.url) || S.chat.browserPane.newTab;
}

/** The site-owned icon, with a browser-style fallback and a quiet loading state. */
function BrowserTabFavicon({ tab }: { tab: DesktopTabState }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tab.faviconUrl]);

  if (tab.loading) {
    return (
      <CircleNotchIcon
        aria-hidden="true"
        size={16}
        className="shrink-0 animate-spin text-gray-400"
      />
    );
  }
  if (tab.faviconUrl !== null && !failed) {
    return (
      <img
        src={tab.faviconUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-4 w-4 shrink-0 rounded-[3px] object-contain"
      />
    );
  }
  return <GlobeSimpleIcon aria-hidden="true" size={17} className="shrink-0 text-gray-400" />;
}

/**
 * One tab: the tab itself, plus the two controls that act on it.
 *
 * The controls are **siblings** of the `role="tab"` element, not descendants of it. A tab is a
 * single interactive thing to a screen reader, and burying two more buttons inside one produces a
 * control whose own activation is ambiguous — the pattern reads fine visually and badly through
 * assistive technology. They live in a `presentation` wrapper that supplies the visual chip while
 * being transparent to the accessibility tree.
 *
 * The tab also carries keyboard equivalents for both controls (Delete closes, `k` keeps), and the
 * two buttons are taken out of the sequential tab order — a roving-tabindex tablist is meant to be
 * a single stop, and three stops per tab would make a five-tab strip fifteen presses deep.
 */
function BrowserTab({
  tab,
  active,
  state,
  tabRef,
  onKeyboardClose,
  onKeyboardSelect,
}: {
  tab: DesktopTabState;
  active: boolean;
  state: BrowserPaneState;
  tabRef: (node: HTMLButtonElement | null) => void;
  /** Closing from the keyboard has to hand focus on; closing with the pointer must not. */
  onKeyboardClose: (tabId: string) => void;
  onKeyboardSelect: (tabId: string) => void;
}): React.ReactElement {
  const { actions } = state;
  const label = tabLabel(tab);
  return (
    <div
      role="presentation"
      data-active={active ? "true" : "false"}
      className={`group relative flex h-7 w-fit min-w-[9.75rem] max-w-56 shrink-0 items-center rounded-xl px-2 transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-inset ${
        active
          ? "bg-gray-100 text-gray-950 dark:bg-gray-800 dark:text-gray-50"
          : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-900"
      }`}
    >
      <button
        type="button"
        role="tab"
        ref={tabRef}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        data-testid="iab-tab"
        data-tab-id={tab.id}
        onClick={() => pointerTabAction(actions.selectTab(tab.id))}
        onKeyDown={(event) => {
          if (event.key === "Delete" || event.key === "Backspace") {
            // The node under the caret is about to disappear. Without handing focus on, it falls
            // out of the tablist entirely and the next arrow key goes nowhere.
            event.preventDefault();
            onKeyboardClose(tab.id);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onKeyboardSelect(tab.id);
          } else if (event.key.toLowerCase() === "k") {
            event.preventDefault();
            actions.setRetain(tab.id, !tab.retain);
          }
        }}
        title={label}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg px-1 text-[13px] font-medium outline-none"
      >
        <BrowserTabFavicon tab={tab} />
        <span className="min-w-0 max-w-40 flex-1 truncate text-left transition-[padding] group-hover:pr-7">
          {label}
        </span>
      </button>
      <button
        type="button"
        // Off the sequential tab order, so the strip stays one stop as a roving-tabindex tablist
        // means it to be. The keyboard route is the tab's own `k`; this is for pointers, and it
        // keeps its accessible name for anyone exploring the strip by touch or screen reader.
        tabIndex={-1}
        aria-pressed={tab.retain}
        aria-label={`${S.chat.browserPane.keep}: ${label}`}
        title={S.chat.browserPane.keepHint}
        onClick={() => actions.setRetain(tab.id, !tab.retain)}
        className={`absolute right-9 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-[color,background-color,opacity] hover:bg-gray-200 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-700 ${
          tab.retain
            ? "text-amber-500"
            : "text-gray-400 opacity-0 group-hover:opacity-100 dark:text-gray-500"
        }`}
      >
        <StarIcon aria-hidden="true" size={15} weight={tab.retain ? "fill" : "regular"} />
      </button>
      <button
        type="button"
        // See the keep button: pointer affordance, not a third tab stop. Delete on the tab itself.
        tabIndex={-1}
        aria-label={`${S.chat.browserPane.closeTab}: ${label}`}
        // Pointer close: no focus transfer. The user is looking at where they clicked, and moving
        // focus to a neighbouring tab would scroll the strip out from under them.
        onClick={() => pointerTabAction(actions.closeTab(tab.id))}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        <XIcon aria-hidden="true" size={14} weight="regular" />
      </button>
    </div>
  );
}

/** The tab strip, including the independent + control that adds to it. */
export function BrowserTabStrip({ state }: { state: BrowserPaneState }): React.ReactElement {
  const { tabs, activeTabId, actions } = state;
  const tabNodes = useRef(new Map<string, HTMLButtonElement>());
  // Armed by keyboard navigation only. Selection is applied by main and arrives as a state push, so
  // the focus move has to wait for that round trip — and it must not steal focus when the selection
  // changed for some other reason (the agent opening a tab, the user clicking one). The rules are
  // in `tab-focus.ts`, where they can be asserted without a rendered strip.
  const focus = useRef(createRovingFocus());

  useEffect(() => {
    const target = focus.current.claim(activeTabId ?? null, (tabId) => tabNodes.current.has(tabId));
    if (target) tabNodes.current.get(target)?.focus();
  }, [activeTabId]);

  /**
   * Selects a tab from the keyboard, keeping focus with the selection.
   *
   * Armed only for a selection that will actually change something, and disarmed again if main
   * refuses — a rejected selection that left it armed would hand focus to whatever *later* change
   * arrived, which in practice means an agent opening a tab pulls the caret out of whatever the
   * user was doing.
   */
  const selectFromKeyboard = (tabId: string | undefined): void => {
    if (!tabId || tabId === activeTabId) return;
    focus.current.arm();
    void actions.selectTab(tabId).catch(() => focus.current.disarm());
  };

  const closeFromKeyboard = (tabId: string): void => {
    // Same contract as a keyboard selection: whatever becomes active gets the caret. A close that
    // fails leaves focus where it was rather than arming a transfer that will never resolve.
    focus.current.arm();
    void actions.closeTab(tabId).catch(() => focus.current.disarm());
  };

  const move = (delta: number): void => {
    if (tabs.length === 0) return;
    const current = tabs.findIndex((tab) => tab.id === activeTabId);
    selectFromKeyboard(tabs[(Math.max(current, 0) + delta + tabs.length) % tabs.length]?.id);
  };

  return (
    <div
      data-testid="iab-tab-strip"
      className="flex h-12 items-center gap-1 overflow-hidden bg-white px-4 py-1 dark:bg-gray-950"
    >
      <div
        role="tablist"
        aria-label={S.chat.browserPane.tabs}
        aria-orientation="horizontal"
        className="no-scrollbar flex min-w-0 shrink items-center gap-1.5 overflow-x-auto"
        onKeyDown={(event) => {
          // Arrow keys move within the strip; Home and End jump to its ends. Handled at the list
          // rather than per tab so the behaviour cannot drift between them — and each of them moves
          // *focus* as well as selection, which is what makes a roving-tabindex strip navigable.
          if (event.key === "ArrowRight") move(1);
          else if (event.key === "ArrowLeft") move(-1);
          else if (event.key === "Home") selectFromKeyboard(tabs[0]?.id);
          else if (event.key === "End") selectFromKeyboard(tabs[tabs.length - 1]?.id);
          else return;
          event.preventDefault();
        }}
      >
        {tabs.map((tab) => (
          <BrowserTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            state={state}
            onKeyboardClose={closeFromKeyboard}
            onKeyboardSelect={selectFromKeyboard}
            tabRef={(node) => {
              if (node) tabNodes.current.set(tab.id, node);
              else tabNodes.current.delete(tab.id);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        aria-label={S.chat.browserPane.newTab}
        data-testid="iab-new-tab"
        onClick={() => {
          void actions.openTab().catch(() => {
            // The conversation may have changed between the render and the click. The next state
            // push already tells the user which strip is current, so there is nothing to surface.
          });
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        <PlusIcon aria-hidden="true" size={17} weight="regular" />
      </button>
    </div>
  );
}

/**
 * The pane's own menu: which browser drives it, and the two things a user does to a profile.
 *
 * Backend choice belongs here rather than in application settings because it is a per-workspace
 * decision the user makes while looking at the browser it applies to. It takes effect for the *next*
 * agent session, never the current one — switching mid-task would throw away the page state the task
 * is built on (design/002 §6.1, §7.3).
 */
function BrowserMenu({
  state,
  open,
  setOpen,
  setBlockingOverlayOpen,
}: {
  state: BrowserPaneState;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Keeps the frozen IAB pixels alive while a modal hides the native view. */
  setBlockingOverlayOpen: (open: boolean) => void;
}): React.ReactElement {
  const {
    backend,
    backendLocked,
    extensionBackendAvailable,
    profileResetLocked,
    actions,
    activeTab,
  } = state;
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [importing, setImporting] = useState(false);
  const closeClear = (): void => {
    setConfirmingClear(false);
    setBlockingOverlayOpen(false);
  };
  const closeImport = (): void => {
    setImporting(false);
    setBlockingOverlayOpen(false);
  };

  useEffect(
    () => () => {
      setBlockingOverlayOpen(false);
    },
    [setBlockingOverlayOpen],
  );

  const row =
    "flex min-h-9 w-full items-center rounded-lg px-3 text-left text-[13px] text-gray-700 transition-colors hover:bg-gray-100 disabled:pointer-events-none disabled:text-gray-300 dark:text-gray-200 dark:hover:bg-gray-800 dark:disabled:text-gray-600";
  const zoom = activeTab?.zoomFactor ?? 1;
  const canZoom = backend === "iab" && activeTab !== null;
  const applyZoom = (factor: number): void => {
    if (!activeTab || factor === activeTab.zoomFactor) return;
    void actions.setZoom(activeTab.id, factor).catch((error: unknown) => {
      toastError(messageOf(error, S.chat.browserPane.zoomFailed));
    });
  };

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        // Portaled and right-aligned: the toolbar sits inside a column with its own overflow, and a
        // menu clipped by it would be unusable at the pane's narrower widths.
        portal={{ direction: "down", align: "right" }}
        menuClass="w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-[0_12px_36px_rgba(15,23,42,0.16)] dark:border-gray-700 dark:bg-gray-900"
        button={
          <button
            type="button"
            aria-label={S.chat.browserPane.title}
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="iab-menu"
            onClick={() => setOpen(!open)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 ${
              open ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200" : ""
            }`}
          >
            <DotsThreeVerticalIcon aria-hidden="true" size={18} weight="bold" />
          </button>
        }
      >
        <p className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
          {S.chat.browserPane.backend}
        </p>
        {(["iab", "extension"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={backend === option}
            // Held shut while a task runs, and main refuses it too: switching browsers mid-task
            // discards the pages the task is working in (design/002 §7.3).
            disabled={backendLocked || (option === "extension" && !extensionBackendAvailable)}
            title={
              backendLocked
                ? S.chat.browserPane.backendLocked
                : option === "extension" && !extensionBackendAvailable
                  ? S.chat.browserPane.backendUnavailable
                  : option === "extension"
                    ? S.chat.browserPane.backendExtensionHint
                    : undefined
            }
            className={`${row} gap-2.5 ${
              backend === option ? "bg-gray-100 font-medium dark:bg-gray-800" : ""
            }`}
            onClick={() => {
              setOpen(false);
              void actions.setBackend(option).catch((error: unknown) => {
                // Main refuses this for reasons the user can act on — a task is running, the flag is
                // off, the relay is not one an extension can reach — and a control that silently
                // does nothing is worse than one that says why.
                toastError(messageOf(error, S.chat.browserPane.backendFailed));
              });
            }}
          >
            <RadioButtonIcon
              aria-hidden="true"
              size={17}
              weight={backend === option ? "fill" : "regular"}
              className={backend === option ? "text-gray-700 dark:text-gray-100" : "text-gray-400"}
            />
            <span>
              {option === "iab"
                ? S.chat.browserPane.backendIab
                : S.chat.browserPane.backendExtension}
            </span>
          </button>
        ))}
        {backend === "extension" ? (
          <p
            role="status"
            className={`mx-1 mt-1 rounded-lg px-2.5 py-2 text-[11px] leading-4 ${
              extensionBackendAvailable
                ? "bg-gray-50 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            }`}
          >
            {extensionBackendAvailable
              ? S.chat.browserPane.backendExtensionSelected
              : S.chat.browserPane.backendExtensionUnavailableSelected}
          </p>
        ) : null}
        <hr className="my-1.5 border-gray-200 dark:border-gray-800" />
        <div
          role="group"
          aria-label={S.chat.browserPane.zoom}
          className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-[13px] text-gray-700 dark:text-gray-200"
        >
          <span>{S.chat.browserPane.zoom}</span>
          <div className="flex items-center gap-1.5">
            <div className="flex h-8 items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                aria-label={S.chat.browserPane.zoomOut}
                title={S.chat.browserPane.zoomOut}
                data-testid="iab-zoom-out"
                disabled={!canZoom || zoom <= 0.5}
                onClick={() => applyZoom(stepBrowserZoom(zoom, -1))}
                className="flex h-full w-9 items-center justify-center text-gray-500 hover:bg-white disabled:text-gray-300 dark:text-gray-300 dark:hover:bg-gray-700 dark:disabled:text-gray-600"
              >
                <MinusIcon aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                title={S.chat.browserPane.zoomReset}
                disabled={!canZoom}
                onClick={() => applyZoom(1)}
                className="h-full min-w-14 border-x border-gray-200 px-2 text-center text-xs font-medium tabular-nums text-gray-800 hover:bg-white disabled:text-gray-300 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:text-gray-600"
              >
                {formatBrowserZoom(zoom)}
              </button>
              <button
                type="button"
                aria-label={S.chat.browserPane.zoomIn}
                title={S.chat.browserPane.zoomIn}
                data-testid="iab-zoom-in"
                disabled={!canZoom || zoom >= 2}
                onClick={() => applyZoom(stepBrowserZoom(zoom, 1))}
                className="flex h-full w-9 items-center justify-center text-gray-500 hover:bg-white disabled:text-gray-300 dark:text-gray-300 dark:hover:bg-gray-700 dark:disabled:text-gray-600"
              >
                <PlusIcon aria-hidden="true" size={15} />
              </button>
            </div>
            <button
              type="button"
              aria-label={S.chat.browserPane.zoomReset}
              title={S.chat.browserPane.zoomReset}
              data-testid="iab-zoom-reset"
              disabled={!canZoom || zoom === 1}
              onClick={() => applyZoom(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:text-gray-200 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:disabled:text-gray-700"
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
        <button
          type="button"
          role="menuitem"
          className={row}
          disabled={!activeTab}
          title={S.chat.browserPane.openInDefaultBrowserHint}
          onClick={() => {
            setOpen(false);
            void actions
              .openInDefaultBrowser()
              .then((opened) => {
                if (!opened) toastError(S.chat.browserPane.openInDefaultBrowserFailed);
              })
              .catch((error: unknown) => {
                toastError(messageOf(error, S.chat.browserPane.openInDefaultBrowserFailed));
              });
          }}
        >
          {S.chat.browserPane.openInDefaultBrowser}
        </button>
        <hr className="my-1.5 border-gray-200 dark:border-gray-800" />
        <p className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
          {S.chat.browserPane.inAppBrowserData}
        </p>
        <button
          type="button"
          role="menuitem"
          className={row}
          data-testid="iab-import"
          // Not gated on a running task: importing adds cookies and history, it does not sign
          // anything out, so it cannot pull the ground from under a task the way a reset can.
          onClick={() => {
            setOpen(false);
            setBlockingOverlayOpen(true);
            setImporting(true);
          }}
        >
          {S.chat.browserPane.import.open}
        </button>
        <button
          type="button"
          role="menuitem"
          className={row}
          data-testid="iab-clear-profile"
          // Held shut while any conversation has a task running, and main refuses it too: the
          // profile is shared, so a reset signs out work the user cannot see from here.
          disabled={profileResetLocked}
          title={profileResetLocked ? S.chat.browserPane.profileResetLocked : undefined}
          onClick={() => {
            setOpen(false);
            setBlockingOverlayOpen(true);
            setConfirmingClear(true);
          }}
        >
          {S.chat.browserPane.clearProfile}
        </button>
      </Dropdown>

      <ConfirmModal
        open={confirmingClear}
        title={S.chat.browserPane.clearProfile}
        confirmLabel={S.chat.browserPane.clearProfile}
        busy={clearing}
        onClose={closeClear}
        onConfirm={() => {
          setClearing(true);
          void actions
            .clearProfile()
            .then(() => {
              closeClear();
              toastSuccess(S.chat.browserPane.clearProfileDone);
            })
            .catch((error: unknown) => {
              // The dialog stays open on failure. Closing it would report success for something
              // that did not happen — and this is the action whose failure means the user is still
              // signed in to everything they just asked to be signed out of.
              toastError(messageOf(error, S.chat.browserPane.clearProfileFailed));
            })
            .finally(() => setClearing(false));
        }}
      >
        {S.chat.browserPane.clearProfileConfirm}
      </ConfirmModal>

      <BrowserImportDialog open={importing} onClose={closeImport} />
    </>
  );
}

/** Back, forward, reload/stop, and the address bar. */
function BrowserToolbar({
  state,
  menuOpen,
  setMenuOpen,
  setBlockingOverlayOpen,
}: {
  state: BrowserPaneState;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  setBlockingOverlayOpen: (open: boolean) => void;
}): React.ReactElement {
  const { activeTab, actions, addressRef, scopeSettled } = state;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionState>(EMPTY_SUGGESTIONS);
  /** Bumped per request so a late answer for an earlier query can be recognised and dropped. */
  const querySeq = useRef(0);

  // The address bar follows the page except while the user is typing in it — an address that
  // rewrote itself mid-edit because a redirect landed would be unusable.
  const shown = editing ? draft : displayUrl(activeTab?.url ?? "");
  useEffect(() => {
    if (!editing) setRejected(null);
  }, [editing, activeTab?.url]);

  // Completion runs only while the box has focus, and is debounced: a request per keystroke would
  // be a main-process round trip per keystroke for a list the user is still typing past.
  useEffect(() => {
    if (!editing || draft.trim() === "") {
      setSuggestions((current) => close(current));
      return;
    }
    const sequence = (querySeq.current += 1);
    const timer = window.setTimeout(() => {
      void desktopBrowserBridge()
        ?.historySuggest(draft)
        .then((entries) => setSuggestions((current) => receive(current, { entries, sequence })))
        .catch(() => {
          // A completion that cannot be produced is not worth reporting to somebody mid-type.
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, editing]);

  /** Navigates to one address, from the box or from the list. Shared by Enter and by a click. */
  const go = (url: string): void => {
    setRejected(null);
    setEditing(false);
    setSuggestions((current) => close(current));
    const work = activeTab ? actions.navigate(activeTab.id, url) : actions.openTab(url);
    void work.catch(() => {
      setEditing(true);
      setRejected(S.chat.browserPane.badUrl);
    });
  };

  const control =
    "rounded px-2 py-1 text-sm text-gray-600 disabled:opacity-30 enabled:hover:bg-gray-100 dark:text-gray-300 dark:enabled:hover:bg-gray-800";

  return (
    <form
      // `relative` so the completion list positions against the toolbar rather than the page.
      className="relative flex items-center gap-1 border-b border-gray-200 px-2 py-1 dark:border-gray-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (!scopeSettled) return;
        // A highlighted suggestion wins over the text in the box, and is already a real URL, so it
        // does not go through `normalizeUrlInput` — it came out of the history store, not a person.
        const picked = chosenUrl(suggestions);
        if (picked !== null) {
          go(picked);
          return;
        }
        const normalized = normalizeUrlInput(draft);
        if (!normalized.ok) {
          if (normalized.reason !== "empty") setRejected(S.chat.browserPane.badUrl);
          return;
        }
        // An empty strip has no tab to navigate, but it is still a valid browser workspace. Treat
        // the submitted address as the first tab instead of presenting an address field that looks
        // editable but is disabled until the user discovers the separate plus button.
        go(normalized.url);
      }}
    >
      <button
        type="button"
        className={control}
        aria-label={S.chat.browserPane.back}
        disabled={!activeTab?.canGoBack}
        onClick={() => activeTab && actions.goBack(activeTab.id)}
      >
        ←
      </button>
      <button
        type="button"
        className={control}
        aria-label={S.chat.browserPane.forward}
        disabled={!activeTab?.canGoForward}
        onClick={() => activeTab && actions.goForward(activeTab.id)}
      >
        →
      </button>
      <button
        type="button"
        className={control}
        aria-label={activeTab?.loading ? S.chat.browserPane.stop : S.chat.browserPane.reload}
        disabled={!activeTab}
        onClick={() => {
          if (!activeTab) return;
          if (activeTab.loading) actions.stop(activeTab.id);
          else actions.reload(activeTab.id);
        }}
      >
        {activeTab?.loading ? "✕" : "⟳"}
      </button>
      <input
        ref={addressRef}
        type="text"
        inputMode="url"
        spellCheck={false}
        aria-label={S.chat.browserPane.address}
        aria-invalid={rejected !== null}
        data-testid="iab-address"
        // Scope confirmation, rather than tab presence, is the safety gate. While a conversation
        // switch is in flight, opening a first tab could otherwise attach it to the previous scope.
        disabled={!scopeSettled}
        value={shown}
        placeholder={S.chat.browserPane.addressPlaceholder}
        role="combobox"
        aria-expanded={suggestions.open}
        aria-controls="iab-address-suggestions"
        aria-autocomplete="list"
        {...(suggestions.selected !== null
          ? { "aria-activedescendant": `iab-suggestion-${suggestions.selected}` }
          : {})}
        onFocus={() => {
          setDraft(displayUrl(activeTab?.url ?? ""));
          setEditing(true);
        }}
        // Deferred: a click on a suggestion fires blur first, and closing the list synchronously
        // would unmount the row before its own click handler ran.
        onBlur={() => {
          window.setTimeout(() => {
            setEditing(false);
            setSuggestions((current) => close(current));
          }, 120);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!suggestions.open) return;
            // Or the caret jumps to the end of the address while the highlight moves.
            event.preventDefault();
            setSuggestions((current) => move(current, event.key === "ArrowDown" ? 1 : -1));
            return;
          }
          if (event.key === "Escape") {
            // First Escape closes the list; a second leaves the address bar. Blurring straight out
            // of an open list would throw away two intentions for one keypress.
            if (suggestions.open) {
              setSuggestions((current) => close(current));
              return;
            }
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
        className={`min-w-0 flex-1 rounded border px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 ${
          rejected ? "border-red-400 dark:border-red-500" : "border-gray-200 dark:border-gray-700"
        }`}
      />
      {suggestions.open && (
        // Absolutely positioned over the page, not in the flow: the pane below is a native view
        // composited above the DOM, so the list is drawn in the toolbar's own stacking context.
        <ul
          id="iab-address-suggestions"
          role="listbox"
          aria-label={S.chat.browserPane.suggestions}
          data-testid="iab-address-suggestions"
          className="absolute left-2 right-2 top-full z-30 max-h-64 overflow-y-auto rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {suggestions.entries.map((entry, index) => {
            const { primary, secondary } = suggestionLabel(entry);
            return (
              <li
                key={entry.url}
                id={`iab-suggestion-${index}`}
                role="option"
                aria-selected={suggestions.selected === index}
                className={`cursor-pointer px-2 py-1 ${
                  suggestions.selected === index
                    ? "bg-blue-50 dark:bg-gray-800"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                // `mouseDown`, not `click`: the input's blur fires first and would otherwise have
                // to be raced. Preventing the default keeps focus in the box until `go` runs.
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(entry.url);
                }}
              >
                <div className="truncate text-xs text-gray-800 dark:text-gray-100">{primary}</div>
                {secondary !== "" && (
                  <div className="truncate font-mono text-[10px] text-gray-500 dark:text-gray-400">
                    {secondary}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <BrowserMenu
        state={state}
        open={menuOpen}
        setOpen={setMenuOpen}
        setBlockingOverlayOpen={setBlockingOverlayOpen}
      />
    </form>
  );
}

/** The strip shown when a page failed to load, and the offer to try again. */
function BrowserFailure({ state }: { state: BrowserPaneState }): React.ReactElement | null {
  const { activeTab, actions } = state;
  if (!activeTab?.failed) return null;
  return (
    <div
      role="status"
      data-testid="iab-failure"
      className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <span className="min-w-0 flex-1 truncate">
        {S.chat.browserPane.loadFailed} — {activeTab.failed.description} ({activeTab.failed.code})
      </span>
      <button
        type="button"
        className="shrink-0 rounded border border-red-300 px-2 py-0.5 hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
        onClick={() => actions.reload(activeTab.id)}
      >
        {S.chat.browserPane.retry}
      </button>
    </div>
  );
}

/**
 * The crash prompt.
 *
 * Deliberately not an automatic restore (design/002 §6.4 三): reopening a batch of booking pages
 * unasked re-enters flows the user may have abandoned, and hands the sites a burst of traffic that
 * reads as automation. It is shown in the pane's own area, which is empty at that moment because no
 * tab has been created yet.
 */
function BrowserRestorePrompt({ state }: { state: BrowserPaneState }): React.ReactElement {
  const { restorable, actions } = state;
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-gray-700 dark:text-gray-200">
        {S.chat.browserPane.restorePrompt(restorable)}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="iab-restore"
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
          onClick={() => {
            // The offer is kept when this fails, so the prompt stays and the button can be pressed
            // again — but only if the user is told, rather than watching nothing happen.
            void actions.restore(true).catch((error: unknown) => {
              toastError(messageOf(error, S.chat.browserPane.restoreFailed));
            });
          }}
        >
          {S.chat.browserPane.restore}
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          onClick={() => {
            void actions.restore(false).catch(() => {
              // Discarding does not fail for anything the user can act on.
            });
          }}
        >
          {S.chat.browserPane.discard}
        </button>
      </div>
    </div>
  );
}

/**
 * The native page's measured rectangle.
 *
 * The rectangle never changes when the Browser menu opens. Instead, a short-lived frozen capture
 * occupies the same box while Electron hides the live native surface, so the page neither blanks
 * nor responsively reflows under the DOM-owned menu.
 */
export function BrowserPaneViewport({
  measureRef,
  menuOpen,
  preview,
}: {
  measureRef: BrowserPaneState["measureRef"];
  menuOpen: boolean;
  preview: DesktopPageCapture | null;
}): React.ReactElement {
  const frozenPage =
    preview === null ? null : (
      <img
        src={preview.dataUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        data-testid="iab-menu-preview"
        style={{
          left: preview.bounds.x,
          top: preview.bounds.y,
          width: preview.bounds.width,
          height: preview.bounds.height,
        }}
        className="pointer-events-none fixed z-40 block select-none"
      />
    );
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={measureRef}
        data-testid="iab-viewport"
        data-menu-open={menuOpen ? "true" : "false"}
        data-menu-preview={preview !== null ? "true" : "false"}
        className="absolute inset-0"
      />
      {frozenPage === null
        ? null
        : typeof document === "undefined"
          ? frozenPage
          : createPortal(frozenPage, document.body)}
    </div>
  );
}

export function BrowserPanePanel({ state }: { state: BrowserPaneState }): React.ReactElement {
  const { measureRef, pane, restorable } = state;
  const [menuOpen, setMenuOpenState] = useState(false);
  const [menuPreview, setMenuPreview] = useState<DesktopPageCapture | null>(null);
  const [blockingOverlayOpen, setBlockingOverlayOpen] = useState(false);
  const menuRequest = useRef(0);

  /**
   * Captures before opening so the native page can hide underneath the menu without a blank frame,
   * responsive reflow, or a permanent empty gutter. Closing is immediate; the preview is kept for
   * a beat while Electron restores the live native surface above it.
   */
  const setMenuOpen = (next: boolean): void => {
    const request = ++menuRequest.current;
    if (!next || state.backend !== "iab") {
      setMenuOpenState(next);
      return;
    }
    void state.actions
      .captureActivePage()
      .catch(() => null)
      .then((preview) => {
        if (request !== menuRequest.current) return;
        setMenuPreview(preview);
        setMenuOpenState(true);
      });
  };

  useEffect(() => {
    menuRequest.current += 1;
    setMenuOpenState(false);
    setMenuPreview(null);
    setBlockingOverlayOpen(false);
  }, [state.backend, pane.sessionScope]);

  useEffect(() => {
    if (menuOpen || blockingOverlayOpen || menuPreview === null) return;
    const timer = window.setTimeout(() => setMenuPreview(null), 120);
    return () => window.clearTimeout(timer);
  }, [blockingOverlayOpen, menuOpen, menuPreview]);
  if (state.backend === "extension") {
    return (
      <div className="flex h-full w-full flex-col bg-white dark:bg-gray-950">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {S.chat.browserPane.backendExtension}
          </span>
          <BrowserMenu
            state={state}
            open={menuOpen}
            setOpen={setMenuOpen}
            setBlockingOverlayOpen={setBlockingOverlayOpen}
          />
        </div>
        <div
          ref={measureRef}
          data-testid="chrome-backend-status"
          role="status"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
        >
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600 dark:bg-blue-950 dark:text-blue-300"
          >
            ◎
          </div>
          <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {S.chat.browserPane.chromePanelTitle}
          </h2>
          <p className="max-w-sm text-xs leading-5 text-gray-600 dark:text-gray-300">
            {state.extensionBackendAvailable
              ? S.chat.browserPane.chromePanelBody
              : S.chat.browserPane.chromePanelUnavailable}
          </p>
          <p className="max-w-sm text-[11px] leading-4 text-gray-400">
            {S.chat.browserPane.chromePanelIabSafe}
          </p>
          {state.extensionBackendAvailable ? (
            <button
              type="button"
              disabled={state.backendLocked}
              title={state.backendLocked ? S.chat.browserPane.backendLocked : undefined}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
              onClick={() => {
                void state.actions.setBackend("extension").catch((error: unknown) => {
                  toastError(messageOf(error, S.chat.browserPane.backendFailed));
                });
              }}
            >
              {S.chat.browserPane.chromePanelCheck}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  const showRestore = restorable > 0 && pane.tabs.length === 0;

  // A restore offer is not a web page. Rendering an empty tab strip, address bar and native-view
  // hole above and below it made the startup state look like a broken blank browser. Give the
  // decision the whole pane; accepting or discarding returns to ordinary browser chrome.
  if (showRestore) {
    return (
      <div className="flex h-full w-full bg-white dark:bg-gray-950">
        <BrowserRestorePrompt state={state} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-gray-950">
      <BrowserTabStrip state={state} />
      <BrowserToolbar
        state={state}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        setBlockingOverlayOpen={setBlockingOverlayOpen}
      />
      {/* Only ever drawn when the page has a sign-in form and something is stored for its origin. */}
      <LoginOfferBar tab={state.activeTab} />
      <BrowserFailure state={state} />
      {/*
        The hole. The active view is positioned over this element's bounding box by the main
        process, so it must reserve real space and must not be given a background that would flash
        through during a resize. The only DOM content in its wrapper is the short-lived frozen menu
        preview, which becomes visible precisely because the native view is occluded at that time.
      */}
      <BrowserPaneViewport measureRef={measureRef} menuOpen={menuOpen} preview={menuPreview} />
    </div>
  );
}
