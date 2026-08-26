/**
 * Draft view (/chat/new): the pre-persistence form of a new
 * conversation, before any Session exists. The input card sits vertically centered (on xl
 * screens a "Jump back in" rail of recent Sessions sits to its right — jump-back-in.tsx);
 * before sending, this is where Agent / Workspace / approval mode / Model are all
 * chosen in one place — two small dropdown pills sit right below the card (pill
 * buttons, styled after ChatGPT's project picker): Agent selection and Workspace
 * directory selection (the menu browses server-side directories, and the current
 * path can be edited directly); the model picker lives in the input card's bottom
 * toolbar, left of the send button (with a vendor logo). The Session is only
 * created when **the first message is sent**; once created, Agent / Workspace /
 * Model are locked in via meta, and only approval mode remains editable (in the
 * session-mode input area).
 *
 * Draft auto-cache (storage and validation in draft-cache.ts; keys are isolated by
 * "user × Project", #68): the four selections are saved as soon as they change;
 * body text is keystroke-frequent and deferred/coalesced (if there's an unsaved
 * change before unmount, one final write is flushed) — closing and returning to
 * the page resumes where you left off; on successful send the cache clears, except
 * the model selection, which carries over as the next conversation's default
 * (switch-becomes-default, mirroring the thinking level persisting on the Agent).
 * The sidebar group header "+" / menu "New conversation" explicitly specify an
 * Agent via route state (overriding the cached selection); the workspace-mode
 * group header "+" additionally carries a Workspace path pre-filling the
 * Workspace selection ("" = temporary workspace). A direct visit or refresh
 * falls back to the cache. When neither route state nor the mount-time cache claims a
 * field, the Project's new-chat defaults ([default_chat]) prefill Agent / Workspace /
 * approval mode (precedence: route state > draft cache > project default > built-in
 * fallback); the model default already flows through models.defaultModel.
 *
 * Saving the Project's new-chat defaults resets the seeded selections so new chats pick
 * the change up: the project-settings dialog strips the cached pins (next visits reseed
 * from the fresh defaults) and dispatches a same-tab chat-defaults-changed event that a
 * MOUNTED draft answers by resetting Agent / Workspace / approval mode / Model in
 * component state (see onDefaultsChanged) — typed-but-unsent text and staged skills
 * always survive.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AirplaneTiltIcon } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { BookOpenTextIcon } from "@phosphor-icons/react/dist/csr/BookOpenText";
import { BrowsersIcon } from "@phosphor-icons/react/dist/csr/Browsers";
import type {
  AgentModelConfigDto,
  AgentSummary,
  ApprovalMode,
  ChatDefaultsDto,
  ModelRefDto,
  ModelsResponse,
  SessionCreateRequest,
  SkillMetadataItem,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatMonthDay } from "../../lib/format";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Chevron } from "../../components/ui/chevron";
import { Dropdown } from "../../components/ui/dropdown";
import { PenguinLogo } from "../../components/ui/penguin-logo";
import { toastError } from "../../components/ui/toast";
import { useVersionInfo } from "../../lib/use-version-info";
import { ChatInput } from "./chat-input";
import { buildSkillsMessage } from "./skill-use";
import { EXAMPLE_TASKS } from "./example-tasks";
import type { ExampleTask, ExampleTaskId } from "./example-tasks";
import { JumpBackIn, type InspirationCardId } from "./jump-back-in";
import { TripConstraintChips } from "./trip-constraint-chips";
import { EMPTY_TRIP_CONSTRAINTS, applyTripPrefix } from "./trip-constraints";
import type { TripConstraints } from "./trip-constraints";
import {
  clearDraft,
  createDraftBrowserScopeId,
  draftBrowserScope,
  draftKey,
  loadDraft,
  saveDraft,
} from "./draft-cache";
import type { DraftCache } from "./draft-cache";
import {
  DRAFT_FLUSH_EVENT,
  getDraftSession,
  removeDraftSession,
  saveDraftSession,
} from "./draft-sessions";
import {
  CHAT_DEFAULTS_CHANGED_EVENT,
  chatDefaultsChangedDetail,
  type ChatDefaultsChangedDetail,
} from "./chat-defaults-event";
import { effectiveThinkingLevel } from "./thinking-level";
import { WorkspaceSelect, pillClass } from "./workspace-select";
import { sameModelRef } from "../models/model-grouping";

/** Coalescing window for writing body text to the cache: keystrokes are frequent, so a short batch accumulates before persisting (option changes are still written immediately). */
const DRAFT_SAVE_DEBOUNCE_MS = 300;

/**
 * "Applied" markers for the route-state overrides (one slot per field, holding the last
 * consumed location.key). React Router persists location.state AND location.key in
 * history.state, which survives a full page reload, while a ref resets with the JS
 * context — with a ref alone, a reload would re-apply the override and clobber whatever
 * the user changed since (restored from the draft cache). sessionStorage is per-tab
 * exactly like history.state, so the marker follows the history entry; on storage
 * failure (private mode) both helpers degrade to "not consumed", and the in-component
 * ref still provides the previous apply-once-per-mount behavior.
 */
type RouteStateField = "agentId" | "workspace" | "tripId";
function loadAppliedRouteKey(field: RouteStateField): string | null {
  try {
    return sessionStorage.getItem(`penguin.chatRouteApplied.${field}`);
  } catch {
    return null;
  }
}
function saveAppliedRouteKey(field: RouteStateField, key: string): void {
  try {
    sessionStorage.setItem(`penguin.chatRouteApplied.${field}`, key);
  } catch {
    /* best-effort: the dedup marker falls back to the per-mount ref */
  }
}

const TASK_ICONS = {
  ctripFlight: AirplaneTiltIcon,
  otaCompare: BrowsersIcon,
  xhsTrip: BookOpenTextIcon,
} as const;

export function DraftView({
  projectId,
  models,
  draftId,
  browserScopeId,
  onReassignBrowserScope,
}: {
  projectId: string;
  /** Project model config (already fetched by ChatPage): candidate list and default model. */
  models: ModelsResponse | null;
  /** Parked draft conversation id (`/chat/draft-…` — see draft-sessions.ts); absent = the ordinary active draft (`/chat/new`). */
  draftId?: string;
  /** Stable opaque identity of this draft's desktop browser strip. */
  browserScopeId: string;
  /** Reassigns the active strip before the first task starts; also performs its one-shot rollback. */
  onReassignBrowserScope: (sessionId: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, currentAgent, setCurrentAgentId } = useProject();
  const { add } = useSessions();
  // The draft key includes a user dimension (#68 cross-account leakage). RequireAuth
  // guarantees the user is logged in here; on the off chance there's no user (the
  // type allows null), it's better to disable caching entirely than to read/write a
  // key that isn't account-scoped.
  const userId = useAuth().user?.userId ?? null;

  // The cache is read only once, on mount: the component remounts keyed by Project (and
  // by parked-draft id), so switching Projects or parked drafts automatically switches to
  // the corresponding content; switching accounts always goes through logout (clearing
  // the user unmounts the whole route tree), so logging back in is likewise a fresh
  // mount. A parked draft reads its own entry instead of the active slot.
  const [parkedMissing] = useState(
    () =>
      draftId !== undefined && (!userId || getDraftSession(userId, projectId, draftId) === null),
  );
  const [cached] = useState<DraftCache>(() => {
    if (!userId) return {};
    if (draftId !== undefined) return getDraftSession(userId, projectId, draftId)?.draft ?? {};
    return loadDraft(draftKey(userId, projectId));
  });

  // A parked id that no longer exists (deleted in the sidebar, stale bookmark): fall
  // back to the plain new-chat draft instead of editing into a void.
  useEffect(() => {
    if (parkedMissing) navigate("/chat/new", { replace: true });
  }, [parkedMissing, navigate]);

  const [agentId, setAgentId] = useState<string | null>(
    cached.agentId ?? currentAgent?.agentId ?? null,
  );
  const [workspace, setWorkspace] = useState(cached.workspace ?? "");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    cached.approvalMode ?? "allow-all",
  );
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(cached.modelRef ?? null);
  const textRef = useRef(cached.text ?? "");
  // Mutable because example-task sends preserve the typed draft: its old strip becomes the sent
  // Session's strip, while the still-cached draft must receive a fresh empty strip for next time.
  const browserScopeIdRef = useRef(browserScopeId);
  /**
   * Selected skills (prefilled by "quick invoke" from the Skills page + checked in
   * the input area): passed to ChatInput as the initial selection via initialSkills
   * on mount, then written back through onSkillsChange and persisted immediately
   * (discrete clicks) — survives a refresh; cleared along with the whole draft on
   * successful send, kept on failure so it can be resent.
   */
  const skillsRef = useRef<string[]>(cached.skills ?? []);

  // —— Project new-chat defaults ([default_chat]) ——
  // Fetched once per Project mount (fail-soft: an error reads as "no defaults", so the
  // draft keeps working). They prefill the seams below with the precedence
  // route location.state > mount-time draft cache > project default > built-in fallback;
  // null = still loading (the thinking picker below stays disabled until resolved).
  const [chatDefaults, setChatDefaults] = useState<ChatDefaultsDto | null>(null);
  /**
   * Set once the chat-defaults-changed event delivered a fresh block (see the reseed
   * handler below): from then on the mount-time fetch must not apply — it was started
   * earlier and would overwrite the fresher event payload when it resolves.
   */
  const defaultsFromEventRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    api
      .getChatDefaults(projectId)
      .then((res) => {
        if (!cancelled && !defaultsFromEventRef.current) setChatDefaults(res);
      })
      .catch(() => {
        if (!cancelled && !defaultsFromEventRef.current) setChatDefaults({});
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * Fields the user already touched this mount: the project defaults arrive async (after
   * mount), and an explicit pick made in the meantime must never be clobbered by them.
   * The mount-time cache (`cached`) covers everything picked in PREVIOUS visits; these
   * refs cover the window between mount and the defaults resolving.
   */
  const touchedRef = useRef({ agent: false, workspace: false, approval: false });

  // Unified resolution of the Agent selection (a single effect, single writer):
  // explicit route state > current valid value (from cache / panel selection) >
  // default_agent > the first one. Explicit intent (sidebar group header "+" / menu
  // "New conversation") is applied only once per location.key — clicking "+" again
  // for the same Agent gets a new key and re-aligns, while the user's subsequent
  // reselection in the panel won't keep getting overridden. Merging this into one
  // effect is essential: splitting it into an "apply state" effect and a "fallback
  // on invalid value" effect would let the former write B in one render while the
  // latter, still judging by the stale closure's invalid value, writes the default
  // Agent and clobbers B.
  const routeState = location.state as {
    agentId?: string;
    workspace?: string;
    tripId?: string;
  } | null;
  /**
   * The Trip this draft belongs to, carried from the sidebar's "new trip" / a trip's "+".
   * Read straight from route state rather than cached: it is not a preference the person is
   * choosing on this screen, it is which journey they clicked to start from. A refresh that
   * loses it lands on an ordinary floating draft, which is the honest fallback — better than
   * silently attaching the conversation to a journey the person is no longer looking at.
   */
  const draftTripId = routeState?.tripId ?? null;
  const stateAgentId = routeState?.agentId;
  const appliedStateKey = useRef<string | null>(null);
  /** One-shot marker for the project-default Agent (seeding precedence, see below). */
  const appliedDefaultAgent = useRef(false);
  useEffect(() => {
    if (agents.length === 0) return; // list not ready yet, nothing to validate against — wait for the next pass
    const valid = (id: string | null | undefined): id is string =>
      !!id && agents.some((a) => a.agentId === id);
    if (
      stateAgentId &&
      appliedStateKey.current !== location.key &&
      loadAppliedRouteKey("agentId") !== location.key
    ) {
      appliedStateKey.current = location.key;
      saveAppliedRouteKey("agentId", location.key);
      if (valid(stateAgentId)) {
        setAgentId(stateAgentId);
        return;
      }
    }
    // Project default ([default_chat].agent_id), inserted ahead of the fallback chain:
    // applied at most once per mount, and only when nothing above it claims the field —
    // no route override consumed this mount, no mount-time cached selection, no panel pick
    // since mount (precedence: route state > draft cache > project default > the
    // currentAgent/default_agent/first fallback the initial state and the line below give).
    if (chatDefaults?.agentId !== undefined && !appliedDefaultAgent.current) {
      appliedDefaultAgent.current = true;
      if (
        appliedStateKey.current === null &&
        cached.agentId === undefined &&
        !touchedRef.current.agent &&
        valid(chatDefaults.agentId)
      ) {
        setAgentId(chatDefaults.agentId);
        return;
      }
    }
    if (valid(agentId)) return;
    setAgentId((agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId ?? null);
  }, [agents, agentId, location.key, stateAgentId, chatDefaults, cached.agentId]);

  // Explicit Workspace from route state (the workspace-mode group header "+"): applied once per
  // location.key, same convention as the Agent above, overriding the cached selection ("" pre-fills
  // the temporary workspace). Unlike the Agent there's no list to validate against, so this is a
  // separate effect that never has to wait for a load.
  const stateWorkspace = routeState?.workspace;
  const appliedWorkspaceKey = useRef<string | null>(null);
  useEffect(() => {
    if (
      stateWorkspace === undefined ||
      appliedWorkspaceKey.current === location.key ||
      loadAppliedRouteKey("workspace") === location.key
    ) {
      return;
    }
    appliedWorkspaceKey.current = location.key;
    saveAppliedRouteKey("workspace", location.key);
    setWorkspace(stateWorkspace);
  }, [location.key, stateWorkspace]);

  // Project defaults for Workspace / approval mode: the same apply-once discipline as the
  // route-state effects above, deferred until the defaults resolve. A field is only seeded
  // when nothing with higher precedence claims it — no route override (workspace only), no
  // mount-time cached value (a cached "" workspace counts: it is an explicit temporary workspace),
  // and no user edit since mount. Model is deliberately not here (models.defaultModel
  // already flows through its own fallback effect below — the single-sourced default).
  const appliedProjectDefaults = useRef(false);
  useEffect(() => {
    if (chatDefaults === null || appliedProjectDefaults.current) return;
    appliedProjectDefaults.current = true;
    if (
      chatDefaults.workspace !== undefined &&
      stateWorkspace === undefined &&
      cached.workspace === undefined &&
      !touchedRef.current.workspace
    ) {
      setWorkspace(chatDefaults.workspace);
    }
    if (
      chatDefaults.approvalMode !== undefined &&
      cached.approvalMode === undefined &&
      !touchedRef.current.approval
    ) {
      setApprovalMode(chatDefaults.approvalMode);
    }
  }, [chatDefaults, stateWorkspace, cached.workspace, cached.approvalMode]);

  // Model fallback: once config is ready, if nothing is selected or the selection is no longer valid, fall back to the project default → the first model (always as a paired reference).
  useEffect(() => {
    if (!models) return;
    if (modelRef && models.models.some((m) => sameModelRef(m, modelRef))) return;
    const first = models.models[0];
    setModelRef(
      models.defaultModel ?? (first ? { provider: first.provider, modelId: first.modelId } : null),
    );
  }, [models, modelRef]);

  /**
   * Live reseed: the project-settings dialog saved new defaults in THIS tab while the
   * draft is mounted. The dialog already stripped the cached pins, but this component's
   * state still holds the old selections and persistNow would silently write them right
   * back over the stripped cache — so the seeded fields are reset here to exactly what a
   * fresh /chat/new mount would now produce (with the cache stripped, the seeding
   * precedence collapses to: fresh project default > built-in fallback); the persist
   * effect then pins the NEW values. Typed text and staged skills are user content and
   * stay untouched; route-state overrides and in-mount picks are superseded — the save is
   * the later explicit intent, and the next fresh mount would drop them anyway. Values
   * come from the event payload (server-confirmed by the dialog's PUTs), not a refetch.
   * The mount-time seeding effects re-run when chatDefaults changes but cannot fight
   * this: their apply-once refs are already consumed, and where they are not, they
   * re-apply the same fresh values.
   */
  const onDefaultsChanged = useCallback(
    (detail: ChatDefaultsChangedDetail) => {
      if (detail.defaults) {
        const d = detail.defaults;
        defaultsFromEventRef.current = true;
        setChatDefaults(d);
        touchedRef.current = { agent: false, workspace: false, approval: false };
        setWorkspace(d.workspace ?? "");
        setApprovalMode(d.approvalMode ?? "allow-all");
        const valid = (id: string | undefined): id is string =>
          id !== undefined && agents.some((a) => a.agentId === id);
        if (valid(d.agentId)) {
          setAgentId(d.agentId);
        } else if (agents.length > 0) {
          // No (valid) default Agent in the new block: the same fallback chain a fresh
          // mount runs — the global current Agent, then default_agent, then the first.
          // Skipped while the list is empty (nothing to validate against; keep the pick).
          setAgentId(
            currentAgent?.agentId ??
              (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId ??
              null,
          );
        }
      }
      // New default model: adopt it directly (the event carries the authoritative pair).
      // Setting null and leaning on the fallback effect would race ChatPage's models
      // refetch and re-pin the STALE default from the old models prop.
      if (detail.defaultModel !== undefined) setModelRef(detail.defaultModel);
    },
    [agents, currentAgent],
  );
  /** Latest-closure mirror for the window listener (same convention as persistRef). */
  const onDefaultsChangedRef = useRef(onDefaultsChanged);
  onDefaultsChangedRef.current = onDefaultsChanged;
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = chatDefaultsChangedDetail(e, projectId);
      if (detail) onDefaultsChangedRef.current(detail);
    };
    window.addEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    return () => window.removeEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
  }, [projectId]);

  // —— Conversation-time thinking level (backed by the Agent settings) ——
  // The picker DISPLAYS the effective level, resolved by the same chain core applies when
  // the Session is created (core agent.ts `configuredThinkingLevel`): the Agent's explicit
  // `model.thinking_level` > the Project's `default_chat.thinking_level` > the built-in
  // "medium" (see effectiveThinkingLevel). `agentThinkingLevel` keeps the raw agent value
  // ("" = no explicit override); the derived value below waits for BOTH fetches. Picking a
  // level immediately persists it via the agent-config API (the PUT carries only that key —
  // the server merges per-key into the YAML, so nothing else is clobbered): the session
  // created on first send reads systemConfig fresh, so it runs with the picked level, which
  // also becomes the Agent's new default — the project default is only a fallback and is
  // never written from here. Refetched whenever the draft's Agent changes; while loading
  // (or after a failed fetch) the picker stays disabled (null).
  const [agentThinkingLevel, setAgentThinkingLevel] = useState<string | null>(null);
  useEffect(() => {
    setAgentThinkingLevel(null);
    if (!agentId) return;
    let cancelled = false;
    api
      .getAgentConfig(projectId, agentId)
      .then((res) => {
        if (!cancelled) setAgentThinkingLevel(res.config.model?.thinkingLevel ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId]);
  const thinkingLevel =
    agentThinkingLevel === null || chatDefaults === null
      ? null
      : effectiveThinkingLevel(agentThinkingLevel, chatDefaults.thinkingLevel);
  /** Live mirror for the rollback value (a stale closure would roll back to an outdated level). */
  const thinkingRef = useRef<string | null>(null);
  thinkingRef.current = agentThinkingLevel;
  const onChangeThinkingLevel = useCallback(
    (level: string) => {
      // "" (no override) is not persistable through the config API — the picker disables that row.
      if (!agentId || !level) return;
      const rollback = thinkingRef.current;
      setAgentThinkingLevel(level); // Optimistic: the derived display follows immediately.
      api
        .putAgentConfig(projectId, agentId, {
          config: { model: { thinkingLevel: level as AgentModelConfigDto["thinkingLevel"] } },
        })
        .catch((e: unknown) => {
          setAgentThinkingLevel(rollback);
          toastError(apiErrorText(e));
        });
    },
    [projectId, agentId],
  );

  // Skills installed on the currently selected Agent (candidates for the input
  // area's skills dropdown): switching Agents first clears the list (which also
  // clears the selection in the input area), then refetches; a fetch failure is
  // silently treated as no skills. Clearing preserves the reference when already
  // empty (doesn't swap in a new array): swapping the reference on the very first
  // mount render would trigger ChatInput's pruning effect and wrongly clear the
  // quick-invoke preselection.
  const [agentSkills, setAgentSkills] = useState<SkillMetadataItem[]>([]);
  /** Whether the skills fetch for the current Agent has settled — the example task waits for it so its `[use_skills]` pinning doesn't silently depend on network timing. */
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  useEffect(() => {
    setAgentSkills((prev) => (prev.length > 0 ? [] : prev));
    setSkillsLoaded(false);
    if (!agentId) return;
    let cancelled = false;
    api
      .getAgentSkills(projectId, agentId)
      .then((res) => {
        if (!cancelled) setAgentSkills(res.skills);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSkillsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId]);

  // —— Auto-cache ——
  // Options (Agent / Workspace / approval mode / Model) are discrete clicks: written
  // immediately on change; body text is keystroke-frequent: debounced trailing write,
  // with a final flush on unmount if there's an unsaved change.
  const saveTimer = useRef<number | null>(null);
  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const persistNow = useCallback(() => {
    cancelPendingSave();
    if (!userId) return;
    const data: DraftCache = {
      text: textRef.current,
      workspace,
      approvalMode,
      browserScopeId: browserScopeIdRef.current,
    };
    if (agentId) data.agentId = agentId;
    if (modelRef) data.modelRef = modelRef;
    if (skillsRef.current.length > 0) data.skills = skillsRef.current;
    // A parked draft writes back into its own list entry; the active draft into its slot.
    if (draftId !== undefined) saveDraftSession(userId, projectId, draftId, data);
    else saveDraft(draftKey(userId, projectId), data);
  }, [cancelPendingSave, userId, projectId, draftId, agentId, workspace, approvalMode, modelRef]);

  // The timer and unmount cleanup read persistNow via a ref to always get the **latest version**: a stale closure would write back outdated options.
  const persistRef = useRef(persistNow);
  useEffect(() => {
    persistRef.current = persistNow;
    // Write immediately on option change (also writes once on mount, idempotently).
    persistNow();
  }, [persistNow]);

  const onTextChange = useCallback(
    (text: string) => {
      textRef.current = text;
      cancelPendingSave();
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        persistRef.current();
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [cancelPendingSave],
  );

  /** Skill checklist change: writes back to the ref and persists immediately (discrete click, same convention as Agent/Model and other options). */
  const onSkillsChange = useCallback((names: string[]) => {
    skillsRef.current = names;
    persistRef.current();
  }, []);

  // Unmount: if there's still unsaved body text, flush it (so a route change/page switch doesn't lose the last few keystrokes).
  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        persistRef.current();
      }
    },
    [],
  );

  // parkActiveDraft ("New chat" clicked while text is typed here) reads the active cache
  // synchronously right after firing this event: flush the debounce window so the park
  // captures the latest keystrokes — and so this instance's unmount flush, which would
  // otherwise fire AFTER the park, has nothing left to write back into the just-cleared
  // active slot. A parked instance flushes into its own entry (harmless).
  useEffect(() => {
    const onFlush = (): void => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        persistRef.current();
      }
    };
    window.addEventListener(DRAFT_FLUSH_EVENT, onFlush);
    return () => window.removeEventListener(DRAFT_FLUSH_EVENT, onFlush);
  }, []);

  /**
   * Discard the draft after a successful send: first cancels the pending save timer, otherwise
   * it would write the just-cleared draft back. The **model selection carries over** as the
   * next conversation's default (review: switching the model, like switching the thinking
   * level, makes the switched-to value the new default — the level persists on the Agent
   * config, the model here in the per-user draft cache); everything else clears.
   */
  const discardDraft = useCallback(() => {
    cancelPendingSave();
    // Clear the preselected skills too: any subsequent write (e.g. the unmount flush) must not resurrect a selection that's already been sent.
    skillsRef.current = [];
    // The unmount flush routes through persistNow, which would otherwise write the
    // just-sent content back (into the parked entry, resurrecting a deleted row): with
    // the text gone the flush becomes an idempotent empty-shell write.
    textRef.current = "";
    if (!userId) return;
    if (draftId !== undefined) {
      // A sent parked draft simply disappears from the list; the ACTIVE slot is not
      // touched — it may hold a different conversation-in-the-making.
      removeDraftSession(userId, projectId, draftId);
      return;
    }
    if (modelRef) saveDraft(draftKey(userId, projectId), { modelRef });
    else clearDraft(draftKey(userId, projectId));
  }, [cancelPendingSave, userId, projectId, draftId, modelRef]);

  const selectAgent = (a: AgentSummary) => {
    touchedRef.current.agent = true; // an explicit pick outranks a late-arriving project default
    setAgentId(a.agentId);
    // Follow through to the global current Agent: keeps the sidebar memory and stats convention consistent.
    setCurrentAgentId(a.agentId);
  };

  /** User edits routed through these two so a late-arriving project default cannot clobber them. */
  const changeWorkspace = useCallback((path: string) => {
    touchedRef.current.workspace = true;
    setWorkspace(path);
  }, []);
  const changeApprovalMode = useCallback((mode: ApprovalMode) => {
    touchedRef.current.approval = true;
    setApprovalMode(mode);
  }, []);

  // One in-flight guard shared by both send entry points (composer send / example task): a
  // second submission while one is running would create a second Session with
  // its own first task and a racing navigation. The ref is the synchronous guard; the state
  // drives disabled styling on the example button (the composer has its own busy state).
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  // First message sent: only now is the Session created (Agent / Workspace / Model / approval
  // mode are all locked in together), then the route jumps once sent; returns false on any
  // failure, so the input area keeps the draft and can resend. `keepDraft` is set by sends
  // that did not consume the composer text (the example task), so a typed-but-unsent draft
  // survives the navigation instead of being silently discarded.
  const onSend = useCallback(
    async (
      input: TaskInputPart[],
      keepDraft = false,
      goal: { budget: number } | null = null,
    ): Promise<boolean> => {
      if (!agentId || sendingRef.current) return false;
      sendingRef.current = true;
      setSending(true);
      let createdId: string | null = null;
      let browserReassigned = false;
      try {
        const body: SessionCreateRequest = { approvalMode };
        // Model reference is submitted as a pair (provider + modelId; falls back to the Project default when not set).
        if (modelRef) {
          body.modelId = modelRef.modelId;
          body.provider = modelRef.provider;
        }
        if (workspace.trim()) body.workspace = workspace.trim();
        // The Session joins its Trip at creation. Membership is a column on the session row,
        // so this decides nothing about where the conversation's files or memory live.
        if (draftTripId !== null) body.tripId = draftTripId;
        const created = await api.createSession(projectId, agentId, body);
        createdId = created.session.sessionId;
        // Promote before starting the task. Otherwise a fast first agent browser call races main,
        // which would still be showing the draft scope and correctly refuse the hidden Session.
        await onReassignBrowserScope(createdId);
        browserReassigned = true;
        const res = await api.postTask(createdId, { input, ...(goal ? { goal } : {}) });
        add(created.session);
        if (keepDraft) {
          browserScopeIdRef.current = createDraftBrowserScopeId();
          persistRef.current();
        } else {
          discardDraft();
        }
        navigate(`/chat/${res.sessionId}`, { replace: true });
        return true;
      } catch (e) {
        // The Session was created but the first message failed to send (postTask failed): delete
        // this empty Session, otherwise every resend attempt would create another one, piling up
        // empty sessions with no messages in the sidebar (best-effort cleanup).
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        if (browserReassigned) {
          // Keep the browser pages with the still-editable draft. Main accepts only this exact
          // inverse of the immediately preceding promotion, so this cannot move another Session.
          await onReassignBrowserScope(draftBrowserScope(browserScopeIdRef.current)).catch(
            () => undefined,
          );
        }
        toastError(apiErrorText(e, modelRef ? { modelId: modelRef.modelId } : {}));
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [
      projectId,
      agentId,
      approvalMode,
      modelRef,
      workspace,
      draftTripId,
      add,
      discardDraft,
      navigate,
      onReassignBrowserScope,
    ],
  );

  // Example tasks: one click submits the canned prompt exactly like a hand-typed send (the
  // busy id drives the clicked card's spinner; the shared in-flight guard and all failure
  // handling live in onSend). keepDraft: an example never consumes the composer text, so a
  // typed-but-unsent draft must survive. The selected model / Workspace / approval mode apply as-is.
  const [exampleBusy, setExampleBusy] = useState<ExampleTaskId | null>(null);

  // Trip-constraint chips (Where/When/Who/Budget): a visible draft of the constraint block
  // the next composer send will prepend (trip-constraints.ts). Deliberately NOT in the
  // draft cache (v1 boundary, design/005 P0); cleared only after a successful send — the
  // example tasks are complete prompts and bypass the chips entirely.
  const [trip, setTrip] = useState<TripConstraints>(EMPTY_TRIP_CONSTRAINTS);
  const sendWithTrip = useCallback(
    async (input: TaskInputPart[], goal: { budget: number } | null): Promise<boolean> => {
      const ok = await onSend(applyTripPrefix(input, trip, S.chat.tripChips), false, goal);
      if (ok) setTrip(EMPTY_TRIP_CONSTRAINTS);
      return ok;
    },
    [onSend, trip],
  );
  const runExample = useCallback(
    async (task: ExampleTask) => {
      if (exampleBusy !== null) return;
      setExampleBusy(task.id);
      try {
        const names = task.skills.filter((n) => agentSkills.some((s) => s.name === n));
        await onSend(
          [{ type: "text", text: buildSkillsMessage(names, S.chat.exampleTasks[task.id].prompt) }],
          true,
        );
      } finally {
        setExampleBusy(null);
      }
    },
    [exampleBusy, agentSkills, onSend],
  );

  // Editorial inspiration cards use the same one-click first-task path as examples. They do
  // not consume the composer's current text, so a partially written draft survives when the
  // user explores an idea and returns later.
  const [inspirationBusy, setInspirationBusy] = useState<InspirationCardId | null>(null);
  const runInspiration = useCallback(
    async (id: InspirationCardId, prompt: string) => {
      if (inspirationBusy !== null) return;
      setInspirationBusy(id);
      try {
        await onSend([{ type: "text", text: prompt }], true);
      } finally {
        setInspirationBusy(null);
      }
    },
    [inspirationBusy, onSend],
  );

  const selectedAgent = agents.find((a) => a.agentId === agentId) ?? null;
  const travellerName = (userId ?? "").split("@")[0]?.trim() ?? "";

  // Capability info for the currently selected model (vision/context window) switches instantly with the selection (matched by paired reference).
  const modelInfo = models?.models.find((m) => sameModelRef(m, modelRef));
  const contextWindow = modelInfo?.contextWindow;
  const vision = modelInfo?.vision !== false;

  return (
    <div
      className="anim-fade flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#fcfcfb] dark:bg-gray-950"
      style={{ scrollbarGutter: "stable both-edges" }}
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between px-5 py-3 md:px-7">
        <div className="flex min-w-0 items-center gap-2.5">
          <PenguinLogo className="h-7 w-7 shrink-0 rounded-lg" />
          <h1 className="truncate text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {S.appName}
          </h1>
        </div>
        <VersionLine />
      </header>

      <div className="draft-welcome-layout flex min-h-144 flex-1 flex-col xl:flex-row xl:justify-center xl:gap-8 xl:px-8">
        <section className="draft-welcome-primary mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 pb-14 pt-2 text-center md:px-8 md:pb-16 md:pt-0 xl:mx-0">
          <img
            src="/travel-collage.png"
            alt=""
            aria-hidden
            draggable={false}
            className="mb-2 h-32 w-32 select-none object-contain sm:h-36 sm:w-36"
          />
          <h2 className="text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-gray-950 sm:text-[2.5rem] dark:text-white">
            {S.chat.draftGreeting(travellerName)}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-7 text-gray-500 dark:text-gray-400">
            {S.chat.draftSubtitle}
          </p>

          <div className="mt-6 w-full text-left">
            <TripConstraintChips value={trip} onChange={setTrip} />
            <ChatInput
              appearance="travel"
              status="idle"
              onSend={sendWithTrip}
              onStop={async () => undefined}
              onCompact={async () => undefined}
              modelRef={modelRef}
              models={models?.models ?? []}
              onChangeModel={setModelRef}
              thinkingLevel={thinkingLevel}
              onChangeThinkingLevel={onChangeThinkingLevel}
              {...(models?.defaultModel !== undefined ? { defaultModel: models.defaultModel } : {})}
              {...(contextWindow !== undefined ? { contextWindow } : {})}
              contextNow={0}
              vision={vision}
              approvalMode={approvalMode}
              onChangeApprovalMode={changeApprovalMode}
              modeSaving={false}
              autoFocus
              agents={agents}
              {...(agentId ? { currentAgentId: agentId } : {})}
              skills={agentSkills}
              {...(cached.skills && cached.skills.length > 0
                ? { initialSkills: cached.skills }
                : {})}
              onSkillsChange={onSkillsChange}
              initialText={cached.text ?? ""}
              onTextChange={onTextChange}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
              <AgentSelect agents={agents} selected={selectedAgent} onSelect={selectAgent} />
              <WorkspaceSelect
                projectId={projectId}
                workspace={workspace}
                onChange={changeWorkspace}
              />
            </div>
          </div>

          <div className="mt-6 w-full">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
              {S.chat.draftPrompt}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
              {EXAMPLE_TASKS.map((task) => {
                const copy = S.chat.exampleTasks[task.id];
                const TaskIcon = TASK_ICONS[task.id];
                return (
                  <button
                    key={task.id}
                    type="button"
                    title={copy.desc}
                    disabled={
                      exampleBusy !== null || sending || !skillsLoaded || !agentId || !models
                    }
                    onClick={() => void runExample(task)}
                    className="group flex min-h-12 items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-700 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[border-color,background-color,color,transform] duration-150 hover:-translate-y-px hover:border-gray-300 hover:text-gray-950 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-white"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors duration-150 group-hover:bg-gray-900 group-hover:text-white dark:bg-gray-800 dark:text-gray-300 dark:group-hover:bg-gray-100 dark:group-hover:text-gray-950">
                      <TaskIcon size={17} weight="regular" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 leading-5">{copy.label}</span>
                    {exampleBusy === task.id && (
                      <span className="shrink-0 text-xs text-gray-400">{S.common.loading}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        <JumpBackIn
          onStartInspiration={(id, prompt) => void runInspiration(id, prompt)}
          inspirationBusy={inspirationBusy}
          inspirationDisabled={sending || !agentId || !models}
        />
      </div>
    </div>
  );
}

/**
 * Superscript "new version" hint on the version line: plain small text raised via
 * align-super, in the version line's own muted color and weight. Deliberately not a pill —
 * user feedback was that the earlier accent-colored pill read as a button; the link case
 * only adds a hover underline. The only remaining copy: the sidebar's version row dropped
 * its badge when the three update rows collapsed into one whose label already names the
 * new version.
 */
const versionBadgeClass =
  "ml-1.5 inline-block align-super text-[10px] leading-4 text-gray-400 dark:text-gray-500";

/**
 * Quiet version line under the brand subtitle: `vX.Y.Z · Last updated Jul 26`
 * (localized per dictionary). The product name is not repeated here — the brand wordmark
 * sits directly above, and the sidebar's version footer is bare `vX.Y.Z` too. The date is
 * the running version's release
 * date, stamped into core's BUILD_DATE at build time — displayed as-is, no network;
 * dev builds and releases that predate the stamping (v0.1.2 and earlier) carry null
 * and show the version alone. When the update check knows a newer release, a small
 * superscript badge follows, linking to the release page (this surface's affordance; the
 * sidebar user menu instead routes its single update row into the update dialog).
 * Fetching starts on mount — useVersionInfo caches at module level, so after the first
 * resolution anywhere in the app this renders instantly and never refetches. Nothing
 * renders until the version resolves (no placeholder flicker under the brand).
 */
function VersionLine() {
  const { locale } = useLocale();
  const { version, update } = useVersionInfo(true);
  if (version === null) return null;
  const date = version.buildDate;
  return (
    <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
      {`v${version.version}${
        date !== null ? ` · ${S.update.lastUpdated(formatMonthDay(date, locale))}` : ""
      }`}
      {update !== null &&
        update.updateAvailable &&
        update.latestVersion !== null &&
        (update.releaseUrl !== null ? (
          <a
            href={update.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={S.update.newVersion(update.latestVersion)}
            aria-label={S.update.newVersion(update.latestVersion)}
            className={`${versionBadgeClass} hover:underline`}
          >
            {S.update.newVersionBadge}
          </a>
        ) : (
          <span className={versionBadgeClass}>{S.update.newVersionBadge}</span>
        ))}
    </p>
  );
}

/** Agent selection (pill dropdown): avatar + name, menu opens downward with an internal scroll cap. */
function AgentSelect({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentSummary[];
  selected: AgentSummary | null;
  onSelect: (agent: AgentSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="left-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] origin-top-left"
      button={
        <button
          type="button"
          title={S.chat.chooseAgent}
          aria-label={S.chat.chooseAgent}
          onClick={() => setOpen(!open)}
          className={pillClass}
        >
          {selected ? (
            <AgentAvatar
              id={selected.agentId}
              name={agentDisplayName(selected)}
              size={16}
              className="shrink-0 rounded"
            />
          ) : null}
          <span className="min-w-0 truncate">
            {selected ? agentDisplayName(selected) : S.common.loading}
          </span>
          <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
        </button>
      }
    >
      <div className="max-h-56 overflow-y-auto">
        {agents.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.common.loading}</p>
        )}
        {agents.map((a) => {
          const active = a.agentId === selected?.agentId;
          return (
            <button
              key={a.agentId}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onSelect(a);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <AgentAvatar
                id={a.agentId}
                name={agentDisplayName(a)}
                size={20}
                className="shrink-0 rounded"
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-xs ${
                    active
                      ? "font-medium text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {agentDisplayName(a)}
                </span>
                {a.description && (
                  <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">
                    {a.description}
                  </span>
                )}
              </span>
              <span className="w-4 shrink-0 text-center text-xs text-gray-500 dark:text-gray-400">
                {active ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
}
