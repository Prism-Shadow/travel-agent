/**
 * "Jump back in" rail on the draft screen (design/005 P0, patterned on Mindtrip's welcome
 * screen): the right-hand column that pulls the traveller back into ongoing conversations
 * instead of leaving the welcome screen a dead end. Shows the three most recent active
 * Sessions (user-created, non-archived — the sidebar's "active" category) as image-first
 * cards in Mindtrip's card grammar: a full-bleed cover, a dark scrim, the title and
 * "Agent · date" line in white on top of it, and at most one status badge floating on the
 * cover (pending-approval count outranks the running pulse — the booking waiting on a human
 * is exactly the session worth resuming). A card click resumes the conversation.
 *
 * The cover is a deterministic decorative gradient + travel-icon watermark derived from the
 * sessionId — deliberately NOT a destination photo. Mindtrip's covers come from its 11M-POI
 * photo library; this product has no image source for a conversation today, and a stock
 * photo of the wrong city on a booking card would be worse than decoration. The honest
 * upgrade documented in design/005 P2 is a screenshot of the real page the agent is working
 * on (the evidence layer), which no stock library can fake.
 *
 * Renders nothing when there are no active Sessions, so a first run keeps the centered
 * greeting composition. The rail is xl-only: below that the draft page keeps its
 * single-column layout and the sidebar remains the session list. Data comes straight from
 * the sessions context (already loaded for the sidebar), so the rail costs no extra fetch —
 * which also means it shows the loaded first pages, plenty for a three-card recency rail.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { AirplaneTiltIcon } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { CompassIcon } from "@phosphor-icons/react/dist/csr/Compass";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatMonthDay } from "../../lib/format";
import { sessionCategory } from "../../lib/session-grouping";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";

/** How many cards the rail shows — Mindtrip's welcome rail shows three; more is a list, not a nudge. */
const RAIL_SIZE = 3;

/**
 * Decorative cover palette (Tailwind gradient stops, spelled out in full so the JIT scanner
 * sees them) and the matching watermark icons. Muted, dusk-leaning travel tones — the card
 * must stay a backdrop for white text, not compete with it.
 */
const COVERS = [
  "from-sky-500 via-blue-600 to-indigo-700",
  "from-amber-400 via-orange-500 to-rose-600",
  "from-emerald-500 via-teal-600 to-cyan-700",
  "from-purple-500 via-violet-600 to-indigo-600",
  "from-rose-400 via-pink-500 to-fuchsia-600",
  "from-cyan-500 via-sky-600 to-blue-700",
] as const;
const COVER_ICONS = [AirplaneTiltIcon, BuildingsIcon, CompassIcon, MapPinIcon] as const;

/** Tiny stable hash (djb2) — the same Session always gets the same cover across visits. */
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (h * 33) ^ id.charCodeAt(i);
  return h >>> 0;
}

export function JumpBackIn() {
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { sessions } = useSessions();
  const { agents } = useProject();

  // Newest-first across all Agents (the context's flat list interleaves per-Agent pages);
  // ISO-8601 strings order lexicographically, so plain string compare is the date sort.
  const recent = useMemo(
    () =>
      sessions
        .filter((s) => sessionCategory(s) === "active")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, RAIL_SIZE),
    [sessions],
  );
  if (recent.length === 0) return null;

  return (
    <aside className="hidden w-[21rem] shrink-0 flex-col justify-center gap-3 pb-14 xl:flex">
      <h3 className="mb-0.5 px-1 text-xs font-medium uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
        {S.chat.jumpBackIn}
      </h3>
      {recent.map((s) => (
        <SessionCard
          key={s.sessionId}
          session={s}
          agentName={resolveAgentName(agents, s.agentId)}
          date={formatMonthDay(s.createdAt, locale)}
          onOpen={() => navigate(`/chat/${s.sessionId}`)}
        />
      ))}
    </aside>
  );
}

/** Display name of the Session's Agent; a Session may outlive its Agent, then the raw id is shown. */
function resolveAgentName(agents: readonly AgentSummary[], agentId: string): string {
  const agent = agents.find((a) => a.agentId === agentId);
  return agent ? agentDisplayName(agent) : agentId;
}

/**
 * One resumable conversation as an image-first card: gradient cover, big soft watermark
 * icon, bottom scrim carrying the white title/meta, one optional status pill top-left
 * (where Mindtrip puts its Trip/Chat/Guide type badge). Hover lifts the card and gently
 * scales the cover — the whole card is one button.
 */
function SessionCard({
  session,
  agentName,
  date,
  onOpen,
}: {
  session: SessionInfo;
  agentName: string;
  date: string;
  onOpen: () => void;
}) {
  const hash = hashId(session.sessionId);
  const cover = COVERS[hash % COVERS.length];
  const Watermark = COVER_ICONS[hash % COVER_ICONS.length]!;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex h-28 w-full flex-col justify-end overflow-hidden rounded-2xl text-left shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-transform duration-150 hover:-translate-y-px"
    >
      <span
        aria-hidden
        className={`absolute inset-0 bg-gradient-to-br ${cover} transition-transform duration-300 group-hover:scale-[1.03]`}
      />
      <Watermark
        aria-hidden
        size={64}
        weight="fill"
        className="absolute -right-2 -top-3 rotate-12 text-white/15"
      />
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 via-black/25 to-transparent"
      />
      {session.pendingApprovalCount > 0 ? (
        <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-amber-400/95 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
          {S.chat.pendingApprovals(session.pendingApprovalCount)}
        </span>
      ) : session.status === "running" ? (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          {S.chat.statusRunning}
        </span>
      ) : null}
      <span className="relative px-4 pb-3">
        <span className="block truncate text-sm font-semibold text-white">
          {session.title ?? S.chat.defaultSessionTitle}
        </span>
        <span className="mt-0.5 block truncate text-xs text-white/75">{`${agentName} · ${date}`}</span>
      </span>
    </button>
  );
}
