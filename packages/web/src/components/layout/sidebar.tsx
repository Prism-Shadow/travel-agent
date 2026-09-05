/**
 * Single-column sidebar, top to bottom: the application's name -> New trip / My Trips / Saved / Models -> the
 * Trips overview link + Trip list -> loose questions -> bottom settings + user config.
 *
 * The top slot is the app's name, not a Project switcher, while only one Project exists: a
 * dropdown with a single choice is furniture, and a role badge announcing that you own the only
 * thing that exists says nothing. The switcher reappears as soon as a second Project does —
 * hiding one that exists would strand it.
 *
 * The first-class object is the **Trip**: each group is a journey, its header carries the
 * identity a traveller recognizes it by (destination, dates), and its rows are that journey's
 * conversations. A Trip with no conversations yet still shows — it exists the moment it is
 * created, and hiding it until its first message would make the click look inert.
 *
 * A conversation belonging to no Trip is not an error state: it lands in the trailing "loose
 * questions" group, which disappears entirely when empty. "Is the rail pass worth it?" should
 * not be forced to become a journey, and a conversation that turns out to be one can be moved
 * in afterwards from its row menu — membership is a column on the session, so moving it never
 * touches where its files or its memory live.
 *
 * Group collapse and pin state persist per Project in localStorage; pinned groups sort first,
 * each partition keeping its own order. Subagent and scheduled conversations stay in collapsed
 * folders. Saved conversations live on /saved, outside these groups; the wire category remains
 * `archived`.
 *
 * Models — the one configuration surface that remains — is a top link beside New trip, My Trips and Saved. The account row opens a compact action menu; preferences live in the shared settings dialog.
 *
 * Desktop keeps the sidebar pinned as the left column; mobile puts the whole thing in a drawer.
 * New chats always enter draft state (/chat/new; route state carries the Agent and, for a new
 * conversation inside a Trip, that Trip). Colour scheme is white/gray-based: active state is a
 * solid gray fill, running status a small dot, no large blocks of colour.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useMatch, useNavigate } from "react-router";
import type {
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
  TripSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { agentDisplayName, projectDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { tripDisplayName, useTrips } from "../../state/trips";
import { tripMetaLine } from "../../lib/trip-format";
import {
  FOLDER_CATEGORIES,
  SCRATCH_GROUP_KEY,
  SIDEBAR_GROUP_PAGE_SIZE,
  SIDEBAR_PAGE_SIZE,
  groupSessionsByTrip,
  partitionSessions,
  pinnedFirst,
  sessionCategory,
} from "../../lib/session-grouping";
import type { FolderCategory, SessionPartition } from "../../lib/session-grouping";
import { Dropdown } from "../ui/dropdown";
import { AgentAvatar } from "../ui/agent-avatar";
import { TravelAgentLogo } from "../ui/travel-agent-logo";
import { ChevronDown, NAV_ICONS } from "../ui/icons";
import { FolderSection, GroupHeader, Icon, MoreRow } from "../ui/group-list";
import { toastError } from "../ui/toast";
import { AccountMenu } from "../account/account-menu";
import { Truncated } from "../ui/truncated";
import { Badge } from "../ui/badge";
import { Modal } from "../ui/modal";
import { ConfirmModal } from "../ui/confirm-modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SkeletonList } from "../ui/skeleton";
import { SuitcaseSimpleIcon } from "@phosphor-icons/react/dist/csr/SuitcaseSimple";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import { useStartConversation } from "../../features/chat/use-start-conversation";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { clearDraft, sessionDraftKey } from "../../features/chat/draft-cache";
import {
  draftSessionTitle,
  removeDraftSession,
  useDraftSessions,
} from "../../features/chat/draft-sessions";
import type { DraftSessionEntry } from "../../features/chat/draft-sessions";

/** Pencil for independent conversations and the loose-questions group. */
export const NEW_CHAT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";

/** A Trip: a suitcase (lid handle + body with a clasp). The product's first-class object. */
export const TRIP_ICON =
  "M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M4 6h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM10 11h4";

/** Pushpin (lucide pin: head + body + stem), the group-header pin toggle / pinned indicator. */
const PIN_ICON =
  "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z";

const menuItemClass =
  "block w-full px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

/**
 * Collapsed-group and pinned-group persistence (survives a refresh), one storage key
 * per Project and concern — group keys are Trip ids, plus the scratch group's own key,
 * and a Trip is Project-scoped. Stray keys left by deleted Trips are harmless (never
 * matched) and the per-Project sets stay tiny.
 */
const collapsedGroupsKey = (projectId: string) => `penguin.sidebarCollapsedGroups.${projectId}`;
const pinnedGroupsKey = (projectId: string) => `penguin.sidebarPinnedGroups.${projectId}`;
/** Reads a persisted group-key set (no Project yet / corrupted storage degrade to empty). */
function loadGroupSet(storageKey: string | null): ReadonlySet<string> {
  if (!storageKey) return new Set();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}
function saveGroupSet(storageKey: string | null, next: ReadonlySet<string>): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...next]));
  } catch {
    /* best-effort persistence (quota/private mode) */
  }
}

/**
 * Open-state key of an origin folder (subagent / scheduled) inside a group:
 * each folder has its own state. "\0" never appears in Agent ids or Workspace paths, so
 * the composite never collides across groups or with plain group keys.
 */
const folderKey = (groupKey: string, category: FolderCategory) => `${category}\0${groupKey}`;

/** Collapse-state key of the parked-drafts group ("\0" keeps it clear of Agent ids and Workspace paths). */
const DRAFTS_GROUP_KEY = "\0drafts";

/** Session status dot: running pulses green, compacting shows an amber dot; idle shows nothing. */
function StatusDot({ session }: { session: SessionInfo }) {
  if (session.status === "running") {
    return (
      <span
        title={S.chat.statusRunning}
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
      />
    );
  }
  if (session.status === "compacting") {
    return (
      <span
        title={S.chat.statusCompacting}
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
      />
    );
  }
  return null;
}

export function Sidebar({
  onNavigate,
  onCollapse,
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    projects,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    agents,
    currentAgent,
    setCurrentAgentId,
  } = useProject();
  const {
    sessions,
    byAgent,
    countsByAgent,
    isLoadedFor,
    hasMoreFor,
    loadMoreFor,
    loading,
    remove,
    replace,
    reload: reloadSessions,
  } = useSessions();
  const { trips, loading: tripsLoading, byId: tripsById, remove: removeTrip } = useTrips();
  const chatMatch = useMatch("/chat/:sessionId");
  const activeSessionId = chatMatch?.params.sessionId ?? null;
  /** The trip whose page is open, if any — read through the router rather than `window.location`. */
  const tripMatch = useMatch("/trips/:tripId");
  const openTripId = tripMatch?.params.tripId ?? null;

  const [projectOpen, setProjectOpen] = useState(false);
  const currentProjectId = currentProject?.projectId ?? null;
  const collapseStoreKey = currentProjectId === null ? null : collapsedGroupsKey(currentProjectId);
  const pinStoreKey = currentProjectId === null ? null : pinnedGroupsKey(currentProjectId);
  /** Collapsed groups (expanded by default), keyed by trip id (or the scratch key); persisted per Project. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() =>
    loadGroupSet(collapseStoreKey),
  );
  /** Pinned groups (sorted before unpinned), keyed like collapsedGroups; persisted per Project. */
  const [pinnedGroups, setPinnedGroups] = useState<ReadonlySet<string>>(() =>
    loadGroupSet(pinStoreKey),
  );
  // Project resolved on first load / switched: swap in that Project's persisted collapse/pin sets.
  useEffect(() => {
    setCollapsedGroups(loadGroupSet(collapseStoreKey));
    setPinnedGroups(loadGroupSet(pinStoreKey));
    setGroupCap(SIDEBAR_GROUP_PAGE_SIZE);
  }, [collapseStoreKey, pinStoreKey]);
  /** Expanded origin folders (collapsed by default), keyed by folderKey. */
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set());
  /** "More" rows with a fetch in flight, keyed `${category}\0${groupKey}` — the row disables and reads "loading" so a page that lands entirely in other groups still visibly did something. */
  const [pendingLoads, setPendingLoads] = useState<ReadonlySet<string>>(new Set());
  /** Per-group display cap for active rows (keyed by group key; absent = SIDEBAR_PAGE_SIZE). "More" raises it a page at a time. */
  const [groupCaps, setGroupCaps] = useState<ReadonlyMap<string, number>>(new Map());
  /** How many GROUPS render (#139: dozens of groups made the list too tall to scan); "more groups" raises it a page at a time, reset per Project. */
  const [groupCap, setGroupCap] = useState(SIDEBAR_GROUP_PAGE_SIZE);
  /** Session pending delete confirmation (null = none). */
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  /** Parked draft conversation pending delete confirmation (null = none). */
  const [deletingDraft, setDeletingDraft] = useState<DraftSessionEntry | null>(null);
  /** Trip pending delete confirmation (null = none). */
  const [deletingTrip, setDeletingTrip] = useState<TripSummary | null>(null);
  const [deletingTripBusy, setDeletingTripBusy] = useState(false);
  /** Parked draft conversations of this user × Project, newest first (reactive module store). */
  const draftEntries = useDraftSessions(user?.userId ?? null, currentProjectId);
  /** Session currently being renamed (null = none) and the title being typed. */
  const [renamingSession, setRenamingSession] = useState<SessionInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  /**
   * Trip groups, plus the trailing scratch group when any conversation belongs to no Trip.
   * Seeded from the Trip list so a journey with no conversations yet still appears.
   */
  const tripGroups = useMemo(
    () =>
      groupSessionsByTrip(
        sessions.filter((session) => !session.archived),
        trips.map((t) => t.tripId),
      ),
    [sessions, trips],
  );

  // Pinned groups first; inside each partition the existing order is kept (the Trip list's
  // own recency order, with loose questions last).
  const orderedTripGroups = useMemo(
    () => pinnedFirst(tripGroups, (g) => g.key, pinnedGroups),
    [tripGroups, pinnedGroups],
  );

  /** Group key of a Session: its Trip, or the scratch group. */
  const sessionGroupKey = (s: SessionInfo) => s.tripId ?? SCRATCH_GROUP_KEY;

  const toggleGroup = (key: string) => {
    // Computed outside the state updater (theme.tsx convention): the persistence write is a
    // side effect, and updaters must stay pure (double-invoked in StrictMode).
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedGroups(next);
    saveGroupSet(collapseStoreKey, next);
  };

  /** Pin / unpin a group (same toggle-and-persist convention as toggleGroup). */
  const togglePin = (key: string) => {
    const next = new Set(pinnedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPinnedGroups(next);
    saveGroupSet(pinStoreKey, next);
  };

  /** In-flight key of one group's category "More" (folderKey shares the same composite for folder categories). */
  const loadKey = (groupKey: string, category: SessionCategory) => `${category}\0${groupKey}`;

  /** loadMoreFor with an in-flight marker for the triggering "More" row (disable + loading text). */
  const trackedLoadMore = (groupKey: string, category: SessionCategory, agentIds: string[]) => {
    const key = loadKey(groupKey, category);
    setPendingLoads((prev) => new Set(prev).add(key));
    void loadMoreFor(agentIds, category).finally(() => {
      setPendingLoads((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    });
  };

  /**
   * Open/close a group's folder. A folder's content is loaded on demand: the first
   * expand fetches its category's first page for every contributing Agent that hasn't
   * been asked yet (already-loaded rows stay put — re-expanding never refetches; the
   * folder's own "More" row does the paging from there).
   */
  const toggleFolder = (groupKey: string, category: FolderCategory, agentIds: string[]) => {
    const key = folderKey(groupKey, category);
    const opening = !openFolders.has(key);
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });
    if (opening) {
      const unloaded = agentIds.filter((id) => !isLoadedFor(id, category));
      if (unloaded.length > 0) void loadMoreFor(unloaded, category);
    }
  };

  // The open chat is an automation-created Session: expand exactly its origin's folder in its
  // group, so the active row is never hidden inside a collapsed origin folder. Saved rows
  // are reached from /saved instead. Auto-expansion fires ONCE per (group, active session): the ref guard
  // keeps list mutations (status ticks, reloads) from re-opening a folder the user explicitly
  // collapsed while that chat stays open. `sessions` must remain a dependency — the active
  // session may not be in the list yet on first render, and the guard is only set once the
  // row is actually found and expanded.
  const lastAutoExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    const s = sessions.find((x) => x.sessionId === activeSessionId);
    if (!s) return;
    const category = sessionCategory(s);
    if (category === "active" || category === "archived") return;
    // The guard also carries the group key: a conversation moved to another Trip belongs to a
    // different folder, and its new one must be allowed to auto-expand once as well.
    const groupKey = s.tripId ?? SCRATCH_GROUP_KEY;
    const guard = `${groupKey}\0${activeSessionId}`;
    if (lastAutoExpandedRef.current === guard) return;
    lastAutoExpandedRef.current = guard;
    const key = folderKey(groupKey, category);
    setOpenFolders((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    // Same on-demand load a click-expand does, for this Session's own Agent (siblings of
    // other contributing Agents stay behind the folder's "More").
    if (!isLoadedFor(s.agentId, category)) void loadMoreFor([s.agentId], category);
  }, [activeSessionId, sessions, isLoadedFor, loadMoreFor]);

  /** Saving keeps the conversation open and makes it reachable through the Saved entry. */
  const toggleArchive = async (s: SessionInfo) => {
    try {
      const res = await api.patchSession(s.sessionId, { archived: !s.archived });
      replace(res.session);
      await reloadSessions();
    } catch (error) {
      toastError(apiErrorText(error));
    }
  };

  const confirmRename = async () => {
    if (!renamingSession) return;
    const title = renameText.trim();
    if (!title) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await api.patchSession(renamingSession.sessionId, { title });
      replace(res.session);
      setRenamingSession(null);
    } catch (e) {
      setRenameError(apiErrorText(e));
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDeleteSession = async () => {
    if (!deletingSession) return;
    setDeletingBusy(true);
    const target = deletingSession;
    try {
      await api.deleteSession(target.sessionId);
      remove(target.sessionId);
      // Desktop only: the pane cannot observe deletion (issue 0009). Best-effort — a failed
      // drop must not resurrect the dialog for a conversation the server already deleted.
      void desktopBrowserBridge()
        ?.dropSession(target.sessionId)
        .catch(() => {});
      // The session is gone, so clear its input draft too (no orphaned keys left in localStorage; keys are scoped per user, #68).
      if (user) clearDraft(sessionDraftKey(user.userId, target.sessionId));
      setDeletingSession(null);
      // The deleted session was the one open: jump to this Agent's next conversation, otherwise
      // fall back to the chat home page. Auto-opened conversations are never archived (hidden by
      // default — landing there would look like the chat vanished into thin air) and never
      // subagent children (they belong to some other conversation).
      if (activeSessionId === target.sessionId) {
        const rest = (byAgent.get(target.agentId) ?? []).filter((s) => {
          const category = sessionCategory(s);
          return (
            s.sessionId !== target.sessionId && (category === "active" || category === "schedule")
          );
        });
        navigate(rest[0] ? `/chat/${rest[0].sessionId}` : "/chat");
      }
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeletingBusy(false);
    }
  };

  const go = (to: string) => {
    navigate(to);
    onNavigate?.();
  };

  const startConversation = useStartConversation();
  const newChat = (agentId?: string, tripId: string | null = null) => {
    startConversation(tripId, agentId);
    onNavigate?.();
  };
  const newTrip = () => newChat(defaultAgentId);

  /**
   * Confirmed trip deletion. The conversations are deliberately not refetched: they keep the
   * trip id they were loaded with, and the grouping already files a conversation whose trip is
   * absent under loose questions — which is exactly where they now belong. Someone standing on
   * the deleted trip's page is moved off it, since that page has nothing left to show.
   */
  const confirmDeleteTrip = async () => {
    if (!deletingTrip) return;
    setDeletingTripBusy(true);
    const target = deletingTrip;
    try {
      await removeTrip(target.tripId);
      setDeletingTrip(null);
      if (openTripId === target.tripId) navigate("/chat");
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeletingTripBusy(false);
    }
  };

  /** Confirmed parked-draft deletion: drops the entry; a deleted draft that is open falls back to the plain new-chat page. */
  const confirmDeleteDraft = () => {
    if (!deletingDraft) return;
    if (user && currentProjectId) {
      removeDraftSession(user.userId, currentProjectId, deletingDraft.id);
    }
    if (activeSessionId === deletingDraft.id) navigate(`/chat/${DRAFT_SESSION_ID}`);
    setDeletingDraft(null);
  };

  /** Target of the menu's "New chat": default_agent, falling back to the first Agent (if the list isn't ready yet, resolution is deferred to the draft page). */
  const defaultAgentId = (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId;

  /** A Session always needs an Agent, so a trip's "+" uses the current Agent, falling back to default_agent. */
  const tripNewChatAgentId = currentAgent?.agentId ?? defaultAgentId;

  /** Moves a conversation into a Trip, between Trips, or out of one (null). */
  const moveSessionToTrip = async (s: SessionInfo, tripId: string | null) => {
    try {
      const res = await api.setSessionTrip(s.sessionId, tripId);
      replace(res.session);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const openSession = (s: SessionInfo) => {
    // Cross-group click: the current Agent follows this Session's own Agent.
    setCurrentAgentId(s.agentId);
    go(`/chat/${s.sessionId}`);
  };

  /** agentId → display name (row hint tooltips, where the group no longer names the Agent). */
  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, agentDisplayName(a)])),
    [agents],
  );

  /** Session rows; withAgentHint adds a small Agent avatar per row when several Agents can appear. */
  const renderRows = (rows: SessionInfo[], withAgentHint: boolean) => (
    <ul className="space-y-0.5">
      {rows.map((s) => (
        <SessionRow
          key={s.sessionId}
          s={s}
          active={s.sessionId === activeSessionId}
          {...(withAgentHint ? { agentHint: agentNameById.get(s.agentId) ?? s.agentId } : {})}
          onOpen={openSession}
          onRename={(x) => {
            setRenameError(null);
            setRenameText(x.title ?? "");
            setRenamingSession(x);
          }}
          onDelete={(x) => setDeletingSession(x)}
          onToggleArchive={(x) => void toggleArchive(x)}
          trips={trips}
          onMoveToTrip={(x, tripId) => void moveSessionToTrip(x, tripId)}
        />
      ))}
    </ul>
  );

  /**
   * Collapsed-by-default lazy folder (subagent / scheduled): nothing is
   * fetched until the first expand, and once open the folder pages independently with
   * its own "More" row.
   *
   * A Trip group has no server-side per-category totals — the server pages Sessions by
   * Agent, and a Trip cuts across Agents — so `totals` is undefined here and every count
   * comes from the rows actually loaded. That degrades honestly: a folder appears only
   * once one of its conversations is in hand, its label counts what is really there, and
   * "More" reveals further loaded rows without claiming a server page it cannot address.
   */
  const renderFolder = (
    groupKey: string,
    category: FolderCategory,
    parts: SessionPartition,
    withAgentHint: boolean,
    /** Agents that may hold this group's rows of this category (fetch fan-out set). */
    agentIds: string[],
    totals: SessionCategoryCounts | undefined,
  ) => {
    const rows = parts[category];
    // Loaded rows win a disagreement with the totals (counts refresh only on reload).
    const total = Math.max(totals?.[category] ?? 0, rows.length);
    if (total === 0) return null;
    // More while the group's share isn't fully loaded AND somewhere is left to fetch from
    // (counts drifting above reality would otherwise leave a dead button until reload).
    const more = rows.length < total && agentIds.some((id) => hasMoreFor(id, category));
    return (
      <FolderSection
        key={category}
        label={S.chat.folderGroups[category](total)}
        open={openFolders.has(folderKey(groupKey, category))}
        onToggle={() => toggleFolder(groupKey, category, agentIds)}
        more={more}
        pending={pendingLoads.has(loadKey(groupKey, category))}
        onMore={() => trackedLoadMore(groupKey, category, agentIds)}
      >
        {renderRows(rows, withAgentHint)}
      </FolderSection>
    );
  };

  /** Active-list "More": reveal one more page of already-loaded active rows AND fetch the next active server page for every Agent that still has one. */
  const showMore = (groupKey: string, agentIds: string[]) => {
    setGroupCaps((prev) => {
      const next = new Map(prev);
      next.set(groupKey, (prev.get(groupKey) ?? SIDEBAR_PAGE_SIZE) + SIDEBAR_PAGE_SIZE);
      return next;
    });
    if (agentIds.length > 0) trackedLoadMore(groupKey, "active", agentIds);
  };

  /**
   * Expanded group body shared by every group: active user rows (display-capped; "More"
   * reveals and loads further **active-only** pages — the folders below never feed it) +
   * the collapsed-by-default subagent / scheduled folders, each loading on
   * first expand and paging on its own. `totals` / `agentsFor` carry the group's exact
   * server share and its fetch fan-out set per category.
   */
  const renderGroupBody = (
    groupKey: string,
    parts: SessionPartition,
    withAgentHint: boolean,
    totals: SessionCategoryCounts | undefined,
    agentsFor: (category: SessionCategory) => string[],
  ) => {
    const cap = groupCaps.get(groupKey) ?? SIDEBAR_PAGE_SIZE;
    const shownActive = parts.active.slice(0, cap);
    // Only the outer active rows drive the group's "More" — the folders never feed it:
    // hidden loaded rows exist, or the group's own active share isn't fully loaded yet.
    const activeAgents = agentsFor("active");
    const activeTotal = Math.max(totals?.active ?? 0, parts.active.length);
    const moreOnServer = activeAgents.some((id) => hasMoreFor(id, "active"));
    // Two independent reasons to offer More: rows already loaded but hidden by the cap, or rows
    // the server still has. The second needs care when `totals` is absent, which is every Trip
    // group — a Trip cuts across Agents, so there is no per-group count to compare against.
    // `activeTotal` then collapses to the loaded length and `length < activeTotal` is false by
    // construction, which silently killed More for any group holding exactly one page: twenty-one
    // conversations showed ten, with nothing to click. Where there is no total, the per-Agent page
    // state is the only authority, and it is enough on its own.
    const hasMore =
      parts.active.length > cap ||
      (totals === undefined ? moreOnServer : parts.active.length < activeTotal && moreOnServer);
    const folders = FOLDER_CATEGORIES.filter((category) => category !== "archived").map(
      (category) =>
        renderFolder(groupKey, category, parts, withAgentHint, agentsFor(category), totals),
    );
    const empty = parts.active.length === 0 && folders.every((f) => f === null);
    const activePending = pendingLoads.has(loadKey(groupKey, "active"));
    return (
      <>
        {/* An empty group says so once, in the count beside its name. A second line spelling
            out "no conversations yet" underneath repeats what the `0` already said. */}
        {empty ? null : renderRows(shownActive, withAgentHint)}

        {/* Load/reveal more (kept adjacent to the active list it extends, above the folders) */}
        {hasMore && (
          <MoreRow
            label={S.chat.loadMore}
            pending={activePending}
            onClick={() => showMore(groupKey, activeAgents)}
            className="mt-0.5"
          />
        )}

        {/* Origin folders stay here; Saved conversations have their own top-level page. */}
        {folders}
      </>
    );
  };

  /** Reveal-next-page-of-groups row (render cap only — data loading is untouched). */
  const moreGroupsRow = (total: number) => (
    <MoreRow
      label={S.chat.moreGroups(total - groupCap)}
      onClick={() => setGroupCap((c) => c + SIDEBAR_GROUP_PAGE_SIZE)}
      className="mt-1"
    />
  );

  return (
    <div className="flex h-full w-full flex-col">
      {/* Brand or Project switcher, with the collapse control at the trailing edge. */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5">
        {/* With one Project there is nothing to switch between, so this is the application's
            name, not a control: a dropdown offering a single choice — and a badge announcing
            that you own the only thing that exists — is furniture. The switcher returns the
            moment a second Project does, because hiding one that exists would make it
            unreachable. Creating Projects and editing their settings live in the developer
            console below, with the rest of the engine's surfaces. */}
        {projects.length <= 1 ? (
          <span className="flex h-10 min-w-0 flex-1 items-center gap-2.5 pr-2 text-lg font-semibold leading-6">
            {/* The mark sits low within its square asset; align its visible silhouette with the label. */}
            <TravelAgentLogo className="relative -top-0.5 h-8 w-8 shrink-0 rounded-md" />
            <span className="relative -top-px truncate">{S.appName}</span>
          </span>
        ) : (
          <Dropdown
            open={projectOpen}
            setOpen={setProjectOpen}
            className="min-w-0 flex-1"
            menuClass="left-0 right-0 top-full mt-1 origin-top"
            button={
              <button
                type="button"
                onClick={() => setProjectOpen(!projectOpen)}
                className="flex h-10 w-full items-center gap-2.5 rounded-md pr-2 text-lg font-semibold leading-6 transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
              >
                <TravelAgentLogo className="relative -top-0.5 h-8 w-8 shrink-0 rounded-md" />
                <span className="relative -top-px min-w-0 flex-1 truncate text-left">
                  {currentProject ? projectDisplayName(currentProject) : S.common.loading}
                </span>
                <span className="text-gray-400">
                  <ChevronDown />
                </span>
              </button>
            }
          >
            {projects.map((p) => (
              <button
                key={p.projectId}
                type="button"
                onClick={() => {
                  setCurrentProjectId(p.projectId);
                  setProjectOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  p.projectId === currentProject?.projectId ? "font-semibold" : ""
                }`}
              >
                <span className="truncate">{projectDisplayName(p)}</span>
                <Badge tone="gray">{p.role}</Badge>
              </button>
            ))}
          </Dropdown>
        )}
        {onCollapse && (
          <button
            type="button"
            title={S.nav.collapseSidebar}
            aria-label={S.nav.collapseSidebar}
            aria-expanded={true}
            onClick={onCollapse}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <SidebarSimpleIcon size={18} aria-hidden />
          </button>
        )}
      </div>

      {/* Navigation can shrink and scroll independently in short windows. */}
      <div className="min-h-0 shrink space-y-1 overflow-y-auto px-3 pb-4 pt-2">
        <button
          type="button"
          onClick={newTrip}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
            activeSessionId === DRAFT_SESSION_ID
              ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
              : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
          }`}
        >
          <span className="text-gray-500 dark:text-gray-400">
            <Icon d={TRIP_ICON} />
          </span>
          {S.trip.newTrip}
        </button>
        <NavLink
          to="/trips"
          end
          onClick={() => onNavigate?.()}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${isActive ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100" : "text-gray-600 hover:bg-gray-200/50 dark:text-gray-400 dark:hover:bg-gray-800/70"}`
          }
        >
          <SuitcaseSimpleIcon size={17} aria-hidden />
          {S.trip.overview.title}
        </NavLink>
        <NavLink
          to="/saved"
          onClick={() => onNavigate?.()}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${isActive ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100" : "text-gray-600 hover:bg-gray-200/50 dark:text-gray-400 dark:hover:bg-gray-800/70"}`
          }
        >
          <BookmarkSimpleIcon size={17} aria-hidden />
          {S.saved.title}
        </NavLink>
        <NavLink
          to="/models"
          onClick={() => onNavigate?.()}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
              isActive
                ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
            }`
          }
        >
          <span className="text-gray-500 dark:text-gray-400">
            <Icon d={NAV_ICONS.models} size={16} />
          </span>
          {S.nav.models}
        </NavLink>
      </div>

      {/* Scroll area: the page nav and the session list scroll together, so the nav rides up
          as the list is scrolled. It is the sidebar's only shrinkable block — with the nav
          pinned, the column's fixed height (Project switcher + New chat + the nav entries +
          user row ≈ 412px) exceeded a short window, and the overflow, clipped by nothing,
          grew the document into a second scrollbar.
          relative: the scroller acts as its own containing block, so absolute descendants
          (each row's sr-only Agent name) anchor and scroll inside it — anchored to the
          initial containing block instead, rows past the fold would bypass this
          overflow-y-auto and stretch the **document**, so expanding "More" / a source
          folder made the whole page scroll (composer pushed up, blank space below). */}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* Unsent drafts, newest first. A section of its own, above the trips: a draft
            belongs to no journey yet — that is what makes it a draft — so listing it under
            the Trips heading said something untrue about it. Hidden entirely while empty. */}
        {draftEntries.length > 0 && (
          <div className="pt-2.5">
            <GroupHeader
              open={!collapsedGroups.has(DRAFTS_GROUP_KEY)}
              onToggle={() => toggleGroup(DRAFTS_GROUP_KEY)}
              icon={
                <span className="shrink-0 text-gray-400 dark:text-gray-500">
                  <Icon d={NEW_CHAT_ICON} size={14} />
                </span>
              }
              label={S.chat.draftGroup}
              uppercase
              count={draftEntries.length}
            />
            {!collapsedGroups.has(DRAFTS_GROUP_KEY) && (
              <ul className="space-y-0.5">
                {draftEntries.map((entry) => (
                  <DraftRow
                    key={entry.id}
                    entry={entry}
                    active={entry.id === activeSessionId}
                    onOpen={() => go(`/chat/${entry.id}`)}
                    onDelete={() => setDeletingDraft(entry)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Section header. The separator spans the sidebar's full width (-mx-2 undoes the
            scroller's padding, px-3 puts the row's own inset back). */}
        <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {S.trip.trips}
        </p>

        {loading && sessions.length === 0 && tripsLoading ? (
          <SkeletonList rows={5} />
        ) : orderedTripGroups.length === 0 ? (
          <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">{S.trip.noTrips}</p>
        ) : (
          orderedTripGroups.slice(0, groupCap).map((group) => {
            const parts = partitionSessions(group.sessions);
            const collapsed = collapsedGroups.has(group.key);
            const pinned = pinnedGroups.has(group.key);
            const trip = group.tripId === null ? null : tripsById.get(group.tripId);
            // A group whose Trip vanished (deleted in another window) renders as loose
            // questions rather than disappearing with its conversations inside it.
            const isScratch = trip === undefined || trip === null;
            const name = trip ? tripDisplayName(trip, S.trip.untitled) : S.trip.scratch;
            const meta = trip ? tripMetaLine(trip, S.trip.meta) : "";
            // A Trip cuts across Agents, so every count here comes from loaded rows and the
            // fetch fan-out is the Agents actually contributing them.
            const contributingAgents = [...new Set(group.sessions.map((s) => s.agentId))];
            return (
              <div key={group.key} className="pt-2.5">
                <GroupHeader
                  open={!collapsed}
                  onToggle={() => toggleGroup(group.key)}
                  icon={
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">
                      <Icon d={isScratch ? NEW_CHAT_ICON : TRIP_ICON} size={15} />
                    </span>
                  }
                  label={name}
                  uppercase={isScratch}
                  count={parts.active.length}
                  {...(trip && !trip.dirExists ? { title: S.trip.folderMissing(trip.dir) } : {})}
                  actions={
                    <>
                      <GroupPinButton pinned={pinned} onToggle={() => togglePin(group.key)} />
                      {!isScratch && (
                        <>
                          {/* New conversation inside this journey: it inherits the trip's
                              identity, so nothing has to be restated. */}
                          <button
                            type="button"
                            title={S.trip.newChatInTrip}
                            aria-label={S.trip.newChatInTrip}
                            onClick={() => newChat(tripNewChatAgentId, trip.tripId)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                          >
                            <Icon d="M12 5v14M5 12h14" size={18} />
                          </button>
                          {/* The journey itself: its identity, its conversations, and the
                              itinerary the agent has written so far. */}
                          {/* Deleting a journey is not the same as deleting its work: the
                              conversations survive as loose questions and the folder stays on
                              disk unless nothing was ever put in it. The confirmation says so,
                              because the button alone cannot. */}
                          <button
                            type="button"
                            title={S.trip.deleteTrip}
                            aria-label={S.trip.deleteTrip}
                            onClick={() => setDeletingTrip(trip)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-red-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-red-400"
                          >
                            {/* Trash can, the same glyph the conversation rows use. */}
                            <Icon
                              d="M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 10.5v6M14 10.5v6"
                              size={15}
                            />
                          </button>
                          <button
                            type="button"
                            title={S.trip.openTrip}
                            aria-label={S.trip.openTrip}
                            onClick={() => go(`/trips/${trip.tripId}`)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                          >
                            <Icon d="M9 6l6 6-6 6" size={16} />
                          </button>
                        </>
                      )}
                    </>
                  }
                />

                {/* The identity line: where / when / who / budget, only for what is set.
                    A trip stated in one sentence often has just a destination, and padding
                    the line with "dates not set" would make that look unfinished. */}
                {!collapsed && meta !== "" && (
                  <p className="truncate px-2.5 pb-1 text-[11px] text-gray-400 dark:text-gray-500">
                    {meta}
                  </p>
                )}
                {!collapsed && trip && !trip.dirExists && (
                  <p className="truncate px-2.5 pb-1 text-[11px] text-amber-600 dark:text-amber-500">
                    {S.trip.folderMissingShort}
                  </p>
                )}

                {collapsed
                  ? null
                  : renderGroupBody(group.key, parts, true, undefined, () => contributingAgents)}
              </div>
            );
          })
        )}
        {orderedTripGroups.length > groupCap ? moreGroupsRow(orderedTripGroups.length) : null}
      </div>

      <AccountMenu onNavigate={onNavigate} />

      {/* Rename chat */}
      <Modal
        open={renamingSession !== null}
        title={S.chat.renameSession}
        onClose={() => (renameBusy ? undefined : setRenamingSession(null))}
        footer={
          <>
            <Button onClick={() => setRenamingSession(null)} disabled={renameBusy}>
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={renameBusy || !renameText.trim()}
              onClick={() => void confirmRename()}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          label={S.chat.renameSessionLabel}
          value={renameText}
          error={renameError ?? undefined}
          autoFocus
          maxLength={120}
          onChange={(e) => {
            setRenameText(e.target.value);
            if (renameError) setRenameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renameText.trim() && !renameBusy) void confirmRename();
          }}
        />
      </Modal>

      {/* Delete trip confirmation. The copy carries the two facts a person needs before
          agreeing: their conversations are not deleted with it, and neither is the folder
          unless the journey never held anything. */}
      <ConfirmModal
        open={deletingTrip !== null}
        title={S.trip.deleteTrip}
        confirmLabel={S.common.delete}
        busy={deletingTripBusy}
        onClose={() => (deletingTripBusy ? undefined : setDeletingTrip(null))}
        onConfirm={() => void confirmDeleteTrip()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingTrip
            ? S.trip.deleteTripConfirm(tripDisplayName(deletingTrip, S.trip.untitled))
            : ""}
        </p>
      </ConfirmModal>

      {/* Delete chat confirmation (shared ConfirmModal) */}
      <ConfirmModal
        open={deletingSession !== null}
        title={S.chat.deleteSession}
        confirmLabel={S.common.delete}
        busy={deletingBusy}
        onClose={() => (deletingBusy ? undefined : setDeletingSession(null))}
        onConfirm={() => void confirmDeleteSession()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingSession
            ? S.chat.deleteSessionConfirm(deletingSession.title ?? S.chat.defaultSessionTitle)
            : ""}
        </p>
      </ConfirmModal>

      {/* Delete parked-draft confirmation: purely local (localStorage entry), but the typed
          content is gone for good, which deserves the same explicit stop as a session. */}
      <ConfirmModal
        open={deletingDraft !== null}
        title={S.chat.deleteDraft}
        confirmLabel={S.common.delete}
        onClose={() => setDeletingDraft(null)}
        onConfirm={confirmDeleteDraft}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingDraft
            ? S.chat.deleteDraftConfirm(draftSessionTitle(deletingDraft) || S.chat.draftUntitled)
            : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}

/** Single parked-draft row: first line of the unsent text + hover delete (opening resumes the draft at `/chat/<draft-id>`). */
function DraftRow({
  entry,
  active,
  onOpen,
  onDelete,
}: {
  entry: DraftSessionEntry;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = draftSessionTitle(entry) || S.chat.draftUntitled;
  return (
    <li>
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active
            ? "bg-gray-200/70 dark:bg-gray-800"
            : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
        }`}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          <Truncated
            text={title}
            className={`min-w-0 flex-1 text-sm ${
              active
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-700 dark:text-gray-300"
            }`}
          />
        </button>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            title={S.chat.deleteDraft}
            aria-label={S.chat.deleteDraft}
            onClick={onDelete}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-all duration-150 hover:bg-gray-300/60 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-red-400"
          >
            <Icon
              d="M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 10.5v6M14 10.5v6"
              size={14}
            />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Group-header pin toggle, shared by every group header: revealed on header hover (or
 * keyboard focus) while unpinned; once pinned it stays visible, doubling as the subtle
 * pinned indicator. The header row carries the `group/header` scope so the reveal only
 * reacts to its own row, not to the session rows' plain `group` scope.
 * The accessible name stays STATIC and aria-pressed alone carries the state — a name that
 * swaps Pin/Unpin alongside aria-pressed reads as "Unpin group, pressed", saying the state
 * twice in conflicting ways. The title tooltip may still swap: it is presentation for pointer
 * users and does not feed the accessible name while aria-label is present.
 */
function GroupPinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      title={pinned ? S.nav.unpinGroup : S.nav.pinGroup}
      aria-label={S.nav.pinGroup}
      aria-pressed={pinned}
      onClick={onToggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${
        pinned
          ? "text-gray-500 dark:text-gray-400"
          : "text-gray-400 opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100 dark:text-gray-500"
      }`}
    >
      <Icon d={PIN_ICON} size={15} />
    </button>
  );
}

/** Single Session row: title + status dot/approval badge + hover action group (rename, archive/unarchive, delete). */
function SessionRow({
  s,
  active,
  agentHint,
  onOpen,
  onRename,
  onDelete,
  onToggleArchive,
  trips,
  onMoveToTrip,
}: {
  s: SessionInfo;
  active: boolean;
  /** Agent display name; when set, a small avatar keeps the Agent context visible on the row. */
  agentHint?: string;
  onOpen: (s: SessionInfo) => void;
  onRename: (s: SessionInfo) => void;
  onDelete: (s: SessionInfo) => void;
  onToggleArchive: (s: SessionInfo) => void;
  /** Every Trip of this Project — the menu's move targets. */
  trips: readonly TripSummary[];
  /** Attach to a Trip, move between Trips, or detach (null). */
  onMoveToTrip: (s: SessionInfo, tripId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const actionBtn =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-all duration-150 focus-visible:opacity-100 group-hover:opacity-100";
  /** Where this conversation could go: every Trip except the one it is already in. */
  const moveTargets = trips.filter((t) => t.tripId !== s.tripId);
  return (
    <li>
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active
            ? "bg-gray-200/70 dark:bg-gray-800"
            : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(s)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          {agentHint !== undefined && (
            <span title={agentHint} className="flex shrink-0 items-center">
              <AgentAvatar id={s.agentId} name={agentHint} size={14} className="rounded" />
              {/* The avatar is aria-hidden and title only serves pointer users: expose the Agent name to keyboard/screen-reader users as visually hidden text inside the row button. */}
              <span className="sr-only">{agentHint}</span>
            </span>
          )}
          {/* Only attach a title attribute when the title is actually truncated (hover to see full text); don't duplicate the text otherwise. */}
          <Truncated
            text={s.title ?? S.chat.defaultSessionTitle}
            className={`min-w-0 flex-1 text-sm ${
              active
                ? "font-medium text-gray-900 dark:text-gray-100"
                : s.archived
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-gray-700 dark:text-gray-300"
            }`}
          />
          {/* No per-row source tag: subagent / scheduled Sessions live in their own labelled, collapsed folders, so a badge on the title would just repeat the folder. */}
          <StatusDot session={s} />
          {s.pendingApprovalCount > 0 && (
            <span title={S.chat.pendingApprovals(s.pendingApprovalCount)}>
              <Badge tone="amber">{s.pendingApprovalCount}</Badge>
            </span>
          )}
        </button>
        {/* Action group: move-to-trip + rename + archive/unarchive + delete */}
        <div className="flex shrink-0 items-center">
          {/* Trip membership. It sits first because it is the one action that changes what
              this conversation *is* rather than how it is displayed — and because moving a
              conversation is safe: it writes one column, leaving the conversation's files
              and memory exactly where they were. */}
          {(moveTargets.length > 0 || s.tripId !== null) && (
            <Dropdown
              open={menuOpen}
              setOpen={setMenuOpen}
              menuClass="right-0 top-full mt-1 w-48 origin-top-right"
              button={
                <button
                  type="button"
                  title={S.trip.moveToTrip}
                  aria-label={S.trip.moveToTrip}
                  onClick={() => setMenuOpen(!menuOpen)}
                  className={`${actionBtn} hover:bg-gray-300/60 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${
                    menuOpen ? "opacity-100" : ""
                  }`}
                >
                  <Icon d={TRIP_ICON} size={14} />
                </button>
              }
            >
              <p className="px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {S.trip.moveToTrip}
              </p>
              {moveTargets.map((t) => (
                <button
                  key={t.tripId}
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setMenuOpen(false);
                    onMoveToTrip(s, t.tripId);
                  }}
                >
                  <Truncated text={tripDisplayName(t, S.trip.untitled)} />
                </button>
              ))}
              {s.tripId !== null && (
                <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
                  <button
                    type="button"
                    className={menuItemClass}
                    onClick={() => {
                      setMenuOpen(false);
                      onMoveToTrip(s, null);
                    }}
                  >
                    {S.trip.removeFromTrip}
                  </button>
                </div>
              )}
            </Dropdown>
          )}
          <button
            type="button"
            title={S.chat.renameSession}
            aria-label={S.chat.renameSession}
            onClick={() => onRename(s)}
            className={`${actionBtn} hover:bg-gray-300/60 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200`}
          >
            <Icon d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3" size={14} />
          </button>
          <button
            type="button"
            title={s.archived ? S.chat.unarchiveSession : S.chat.archiveSession}
            aria-label={s.archived ? S.chat.unarchiveSession : S.chat.archiveSession}
            onClick={() => onToggleArchive(s)}
            className={`${actionBtn} hover:bg-gray-300/60 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200`}
          >
            <BookmarkSimpleIcon size={14} weight={s.archived ? "fill" : "regular"} aria-hidden />
          </button>
          <button
            type="button"
            title={S.chat.deleteSession}
            aria-label={S.chat.deleteSession}
            onClick={() => onDelete(s)}
            className={`${actionBtn} hover:bg-gray-300/60 hover:text-red-600 dark:hover:bg-gray-700 dark:hover:text-red-400`}
          >
            {/* Trash can: lid (4..20), handle, body (5..19, symmetric sides), two vertical ribs */}
            <Icon
              d="M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 10.5v6M14 10.5v6"
              size={14}
            />
          </button>
        </div>
      </div>
    </li>
  );
}
