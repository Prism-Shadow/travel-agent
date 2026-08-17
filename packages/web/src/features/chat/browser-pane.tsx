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
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { BrowserImportDialog } from "./browser-import-dialog";
import { ariaValueNow, MAX_PANE_FRACTION, MIN_PANE_FRACTION } from "./browser-pane-split";
import { displayUrl, normalizeUrlInput, originOf } from "./browser-url";
import { createRovingFocus, pointerTabAction } from "./tab-focus";
import type { BrowserPaneState } from "./use-browser-pane";
import type { DesktopTabState } from "../../lib/desktop-bridge";

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
      className={`flex min-w-0 max-w-[12rem] shrink items-center gap-1 rounded-t border-b-2 px-1 ${
        active
          ? "border-blue-500 bg-white dark:bg-gray-900"
          : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
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
        className={`flex min-w-0 flex-1 items-center gap-1 px-1 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          active ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {tab.loading ? (
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
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
        className={`shrink-0 rounded px-1 leading-none ${
          tab.retain ? "text-amber-500" : "text-gray-300 hover:text-gray-500 dark:text-gray-600"
        }`}
      >
        ★
      </button>
      <button
        type="button"
        // See the keep button: pointer affordance, not a third tab stop. Delete on the tab itself.
        tabIndex={-1}
        aria-label={`${S.chat.browserPane.closeTab}: ${label}`}
        // Pointer close: no focus transfer. The user is looking at where they clicked, and moving
        // focus to a neighbouring tab would scroll the strip out from under them.
        onClick={() => pointerTabAction(actions.closeTab(tab.id))}
        className="shrink-0 rounded px-1 leading-none text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        ✕
      </button>
    </div>
  );
}

/** The tab strip, including the ⊕ that adds to it. */
function BrowserTabStrip({ state }: { state: BrowserPaneState }): React.ReactElement {
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
    <div className="flex items-end gap-1 overflow-x-auto border-b border-gray-200 px-2 pt-1 dark:border-gray-800">
      <div
        role="tablist"
        aria-label={S.chat.browserPane.tabs}
        aria-orientation="horizontal"
        className="flex min-w-0 flex-1 items-end gap-1"
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
        className="mb-1 shrink-0 rounded px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        ＋
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
function BrowserMenu({ state }: { state: BrowserPaneState }): React.ReactElement {
  const {
    backend,
    backendLocked,
    extensionBackendAvailable,
    profileResetLocked,
    actions,
    activeTab,
  } = state;
  const [open, setOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [importing, setImporting] = useState(false);

  const row =
    "block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800";

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        // Portaled and right-aligned: the toolbar sits inside a column with its own overflow, and a
        // menu clipped by it would be unusable at the pane's narrower widths.
        portal={{ direction: "down", align: "right" }}
        menuClass="w-64 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        button={
          <button
            type="button"
            aria-label={S.chat.browserPane.title}
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="iab-menu"
            onClick={() => setOpen(!open)}
            className="shrink-0 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ⋯
          </button>
        }
      >
        <p className="px-3 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-gray-400">
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
                  : undefined
            }
            className={row}
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
            {backend === option ? "● " : "○ "}
            {option === "iab" ? S.chat.browserPane.backendIab : S.chat.browserPane.backendExtension}
          </button>
        ))}
        <hr className="my-1 border-gray-200 dark:border-gray-800" />
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
        <button
          type="button"
          role="menuitem"
          className={row}
          data-testid="iab-import"
          // Not gated on a running task: importing adds cookies and history, it does not sign
          // anything out, so it cannot pull the ground from under a task the way a reset can.
          onClick={() => {
            setOpen(false);
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
        onClose={() => setConfirmingClear(false)}
        onConfirm={() => {
          setClearing(true);
          void actions
            .clearProfile()
            .then(() => {
              setConfirmingClear(false);
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

      <BrowserImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

/** Back, forward, reload/stop, and the address bar. */
function BrowserToolbar({ state }: { state: BrowserPaneState }): React.ReactElement {
  const { activeTab, actions, addressRef, scopeSettled } = state;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  // The address bar follows the page except while the user is typing in it — an address that
  // rewrote itself mid-edit because a redirect landed would be unusable.
  const shown = editing ? draft : displayUrl(activeTab?.url ?? "");
  useEffect(() => {
    if (!editing) setRejected(null);
  }, [editing, activeTab?.url]);

  const control =
    "rounded px-2 py-1 text-sm text-gray-600 disabled:opacity-30 enabled:hover:bg-gray-100 dark:text-gray-300 dark:enabled:hover:bg-gray-800";

  return (
    <form
      className="flex items-center gap-1 border-b border-gray-200 px-2 py-1 dark:border-gray-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (!scopeSettled) return;
        const normalized = normalizeUrlInput(draft);
        if (!normalized.ok) {
          if (normalized.reason !== "empty") setRejected(S.chat.browserPane.badUrl);
          return;
        }
        setRejected(null);
        setEditing(false);
        // An empty strip has no tab to navigate, but it is still a valid browser workspace. Treat
        // the submitted address as the first tab instead of presenting an address field that looks
        // editable but is disabled until the user discovers the separate plus button.
        const work = activeTab
          ? actions.navigate(activeTab.id, normalized.url)
          : actions.openTab(normalized.url);
        void work.catch(() => {
          // Keep the submitted text available for correction or retry rather than replacing it with
          // the old page (or an empty strip) after a rejected IPC call.
          setEditing(true);
          setRejected(S.chat.browserPane.badUrl);
        });
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
        onFocus={() => {
          setDraft(displayUrl(activeTab?.url ?? ""));
          setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
        className={`min-w-0 flex-1 rounded border px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 ${
          rejected ? "border-red-400 dark:border-red-500" : "border-gray-200 dark:border-gray-700"
        }`}
      />
      <BrowserMenu state={state} />
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
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
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

export function BrowserPanePanel({ state }: { state: BrowserPaneState }): React.ReactElement {
  const { measureRef, pane, restorable } = state;
  const showRestore = restorable > 0 && pane.tabs.length === 0;

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-gray-950">
      <BrowserTabStrip state={state} />
      <BrowserToolbar state={state} />
      <BrowserFailure state={state} />
      {showRestore ? <BrowserRestorePrompt state={state} /> : null}

      {/*
        The hole. The active view is positioned over this element's bounding box by the main
        process, so it must reserve real space and must not be given a background that would flash
        through during a resize. Nothing may be rendered inside it: a WebContentsView paints above
        the DOM, so any child would simply be invisible.
      */}
      <div ref={measureRef} className="min-h-0 flex-1" data-testid="iab-viewport" />
    </div>
  );
}
