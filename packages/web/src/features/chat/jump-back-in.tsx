/**
 * Image-first discovery column on the draft screen, in two mutually exclusive states.
 *
 * First run (no trips, no conversations): "Get inspired" — three editorial prompts that give
 * the empty product a first click. Inspiration is scaffolding, and scaffolding comes down when
 * the building stands: from the first real trip or conversation the rail belongs to the
 * person's own work, because a returning traveller wants "how is my Kyoto trip doing", not a
 * canned card blind to the Kyoto trip already in the sidebar.
 *
 * Returning: "Up next" — one large card for the trip that matters now (soonest future
 * departure, else latest touched), carrying a departure countdown, an aggregate
 * waiting-on-you badge (click-as-authorization is the product's core verb, so what waits for a
 * click leads the screen), the trip's own meta line, and its conversation count — followed by
 * "Jump back in", the recent conversations demoted to smaller tiles. Every pixel is rendered
 * from trip.json fields and the session index; there is no model call here, because the root
 * spec declines a proactive AI opener and a countdown is arithmetic, not judgement.
 *
 * The trip card and the session tiles deliberately differ in size and structure: they are
 * different kinds of thing (an object with state vs a conversation), and the earlier design
 * bug worth not repeating was two identical-looking cards with different verbs. Covers come
 * from the local generated catalog, deduplicated across everything visible; they never
 * pretend to be evidence from the conversation itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { AgentSummary, SessionInfo, TripSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatMonthDay } from "../../lib/format";
import { sessionCategory } from "../../lib/session-grouping";
import {
  selectTravelCovers,
  TRAVEL_COVER_CATALOG,
  type TravelCoverAsset,
} from "../../lib/travel-cover-library";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { useTrips } from "../../state/trips";
import { travellerCount, whenText } from "../../lib/trip-format";

/** Three cards keep the rail useful without duplicating the sidebar as another long list. */
const RAIL_SIZE = 3;

export const INSPIRATION_CARDS = [
  { id: "kyotoAutumn", coverId: "kyoto-temple" },
  { id: "bangkokFood", coverId: "food-market" },
  { id: "northernLights", coverId: "northern-lights" },
] as const;

export type InspirationCardId = (typeof INSPIRATION_CARDS)[number]["id"];

/** Local calendar day as `YYYY-MM-DD` — not UTC, because "departs in 2 days" is asked at home. */
function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The trip the rail leads with. A deterministic data rule, deliberately not a judgement:
 * the soonest future departure wins (today counts — departure day is the day the card matters
 * most), and when no trip has a future date, the one touched most recently.
 */
export function pickUpNextTrip(
  trips: readonly TripSummary[],
  todayIso: string,
): TripSummary | null {
  const dated = trips
    .filter((t) => t.when?.kind === "dates" && t.when.start.trim() >= todayIso)
    .sort((a, b) => {
      const sa = a.when!.kind === "dates" ? a.when!.start : "";
      const sb = b.when!.kind === "dates" ? b.when!.start : "";
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  if (dated.length > 0) return dated[0]!;
  const touched = [...trips].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  return touched[0] ?? null;
}

/** Whole days from `todayIso` to `startIso`, both local calendar days (0 = departs today). */
export function daysUntil(startIso: string, todayIso: string): number {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!, 12);
  };
  return Math.round((parse(startIso) - parse(todayIso)) / 86_400_000);
}

/** Shared resize-aware behavior for both horizontal card rails. */
function useHorizontalRail(itemCount: number) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateScrollState = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setCanScrollBack(scroller.scrollLeft > 4);
    setCanScrollForward(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    updateScrollState();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollState);
    observer?.observe(scroller);
    window.addEventListener("resize", updateScrollState);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateScrollState);
    };
  }, [itemCount, updateScrollState]);

  const scrollCards = useCallback((direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const firstCard = scroller.querySelector<HTMLElement>("[data-rail-card]");
    const gap = Number.parseFloat(getComputedStyle(scroller).columnGap) || 12;
    scroller.scrollBy({
      left: direction * ((firstCard?.offsetWidth ?? scroller.clientWidth * 0.75) + gap),
      behavior: "smooth",
    });
  }, []);

  return { scrollerRef, canScrollBack, canScrollForward, updateScrollState, scrollCards };
}

export function JumpBackIn({
  onStartInspiration,
  inspirationBusy,
  inspirationDisabled,
}: {
  onStartInspiration: (id: InspirationCardId, prompt: string) => void;
  inspirationBusy: InspirationCardId | null;
  inspirationDisabled: boolean;
}) {
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { sessions } = useSessions();
  const { trips } = useTrips();
  const { agents } = useProject();

  const active = useMemo(() => sessions.filter((s) => sessionCategory(s) === "active"), [sessions]);

  // Waiting-on-you first — a pending approval is the one thing on this screen that is asking
  // for a click — then newest-first across all Agents (the context's flat list interleaves
  // per-Agent pages). ISO-8601 strings order lexicographically, so a string compare is the sort.
  const recent = useMemo(
    () =>
      [...active]
        .sort((a, b) => {
          const pa = a.pendingApprovalCount > 0 ? 1 : 0;
          const pb = b.pendingApprovalCount > 0 ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
        })
        .slice(0, RAIL_SIZE),
    [active],
  );

  const todayIso = useMemo(localTodayIso, []);
  const upNext = useMemo(() => pickUpNextTrip(trips, todayIso), [trips, todayIso]);
  // The trip's conversation footprint, from the index the sidebar already loaded.
  const upNextSessions = useMemo(
    () => (upNext === null ? [] : active.filter((s) => s.tripId === upNext.tripId)),
    [active, upNext],
  );
  const upNextPending = upNextSessions.reduce((sum, s) => sum + s.pendingApprovalCount, 0);

  // Scaffolding rule: editorial inspiration exists only while there is nothing real to show.
  const firstRun = trips.length === 0 && recent.length === 0;

  // One selection call across the trip card and the session tiles, so the dedup guarantee
  // spans everything visible at once. No cover is reserved for the inspiration cards: the two
  // states are mutually exclusive, so "Kyoto" may use the kyoto-temple image that the
  // first-run kyotoAutumn card also uses — they can never be on screen together.
  const covers = useMemo(
    () =>
      selectTravelCovers(
        [
          ...(upNext === null
            ? []
            : [
                {
                  sessionId: upNext.tripId,
                  title: upNext.name || upNext.destination,
                },
              ]),
          ...recent.map((session) => ({
            sessionId: session.sessionId,
            title: session.title,
          })),
        ],
        TRAVEL_COVER_CATALOG,
      ),
    [recent, upNext],
  );
  const tripCover = upNext === null ? null : covers[0]!;
  const sessionCovers = upNext === null ? covers : covers.slice(1);
  const recentRail = useHorizontalRail(recent.length);
  const inspirationRail = useHorizontalRail(INSPIRATION_CARDS.length);

  return (
    <aside className="draft-jump-back-in hidden w-84 shrink-0 flex-col justify-center pb-14 xl:flex">
      <div className="flex flex-col gap-7">
        {upNext !== null && tripCover !== null && (
          <section aria-labelledby="up-next-heading">
            <h3
              id="up-next-heading"
              className="mb-3 px-1 text-xl font-semibold tracking-[-0.02em] text-gray-950 dark:text-white"
            >
              {S.chat.upNext.title}
            </h3>
            <UpNextCard
              trip={upNext}
              cover={tripCover}
              chats={upNextSessions.length}
              pending={upNextPending}
              todayIso={todayIso}
              locale={locale}
              onOpen={() => navigate(`/trips/${upNext.tripId}`)}
            />
          </section>
        )}

        {recent.length > 0 && (
          <section aria-labelledby="jump-back-in-heading">
            <h3
              id="jump-back-in-heading"
              className="mb-3 px-1 text-xl font-semibold tracking-[-0.02em] text-gray-950 dark:text-white"
            >
              {S.chat.jumpBackIn}
            </h3>

            <div className="relative -mx-1">
              <div
                ref={recentRail.scrollerRef}
                onScroll={recentRail.updateScrollState}
                className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-1.5"
              >
                {recent.map((session, index) => (
                  <SessionCard
                    key={session.sessionId}
                    session={session}
                    agentName={resolveAgentName(agents, session.agentId)}
                    date={formatMonthDay(session.createdAt, locale)}
                    cover={sessionCovers[index]!}
                    onOpen={() => navigate(`/chat/${session.sessionId}`)}
                  />
                ))}
              </div>
              <RailNavigation
                canScrollBack={recentRail.canScrollBack}
                canScrollForward={recentRail.canScrollForward}
                previousLabel={S.chat.jumpBackInPrevious}
                nextLabel={S.chat.jumpBackInNext}
                onPrevious={() => recentRail.scrollCards(-1)}
                onNext={() => recentRail.scrollCards(1)}
              />
            </div>
          </section>
        )}

        {firstRun && (
          <section aria-labelledby="get-inspired-heading">
            <h3
              id="get-inspired-heading"
              className="mb-3 px-1 text-xl font-semibold tracking-[-0.02em] text-gray-950 dark:text-white"
            >
              {S.chat.getInspired.title}
            </h3>

            <div className="relative -mx-1">
              <div
                ref={inspirationRail.scrollerRef}
                onScroll={inspirationRail.updateScrollState}
                className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-1.5"
              >
                {INSPIRATION_CARDS.map((card) => {
                  const copy = S.chat.getInspired.cards[card.id];
                  const cover = TRAVEL_COVER_CATALOG.find((asset) => asset.id === card.coverId)!;
                  return (
                    <InspirationCard
                      key={card.id}
                      title={copy.title}
                      tag={copy.tag}
                      cover={cover}
                      busy={inspirationBusy === card.id}
                      disabled={inspirationDisabled || inspirationBusy !== null}
                      onOpen={() => onStartInspiration(card.id, copy.prompt)}
                    />
                  );
                })}
              </div>
              <RailNavigation
                canScrollBack={inspirationRail.canScrollBack}
                canScrollForward={inspirationRail.canScrollForward}
                previousLabel={S.chat.getInspired.previous}
                nextLabel={S.chat.getInspired.next}
                onPrevious={() => inspirationRail.scrollCards(-1)}
                onNext={() => inspirationRail.scrollCards(1)}
              />
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function RailNavigation({
  canScrollBack,
  canScrollForward,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
}: {
  canScrollBack: boolean;
  canScrollForward: boolean;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <>
      {canScrollBack && (
        <button
          type="button"
          aria-label={previousLabel}
          onClick={onPrevious}
          className="absolute left-0 top-1/2 z-10 flex h-10 w-10 -translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-gray-950 shadow-[0_8px_24px_rgb(0_0_0/0.16)] transition-transform duration-150 hover:scale-105 dark:border-white/15 dark:bg-gray-900 dark:text-white"
        >
          <CaretLeftIcon size={20} weight="bold" aria-hidden />
        </button>
      )}
      {canScrollForward && (
        <button
          type="button"
          aria-label={nextLabel}
          onClick={onNext}
          className="absolute right-0 top-1/2 z-10 flex h-10 w-10 translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-gray-950 shadow-[0_8px_24px_rgb(0_0_0/0.16)] transition-transform duration-150 hover:scale-105 dark:border-white/15 dark:bg-gray-900 dark:text-white"
        >
          <CaretRightIcon size={20} weight="bold" aria-hidden />
        </button>
      )}
    </>
  );
}

/**
 * The returning-state lead card: one Trip as an object with state. Bigger than a session tile
 * and structured differently on purpose — identical cards with different verbs was the design
 * bug this rail replaces. Everything on it is data: countdown from `when.start`, badge from
 * summed `pendingApprovalCount`, meta from the trip's own fields.
 */
function UpNextCard({
  trip,
  cover,
  chats,
  pending,
  todayIso,
  locale,
  onOpen,
}: {
  trip: TripSummary;
  cover: TravelCoverAsset;
  chats: number;
  pending: number;
  todayIso: string;
  locale: "zh" | "en";
  onOpen: () => void;
}) {
  const T = S.chat.upNext;
  const days =
    trip.when?.kind === "dates" && trip.when.start.trim() >= todayIso
      ? daysUntil(trip.when.start.trim(), todayIso)
      : null;
  const countdown =
    days === null
      ? null
      : days === 0
        ? T.departsToday
        : days === 1
          ? T.departsTomorrow
          : T.departsInDays(days);
  // The shared meta line spells dates as full ISO — right at sidebar width, a truncation on a
  // 336px card, so a two-ended range compacts to month-day here. The destination part is
  // dropped too: the card's title is the trip's name, which is the destination in every case
  // the card exists for. Travellers and budget reuse the shared copy verbatim.
  const metaCopy = S.trip.meta;
  const start = trip.when?.kind === "dates" ? trip.when.start.trim() : "";
  const end = trip.when?.kind === "dates" ? trip.when.end.trim() : "";
  const whenPart =
    start !== "" && end !== ""
      ? `${formatMonthDay(start, locale)} – ${formatMonthDay(end, locale)}`
      : whenText(trip.when, metaCopy);
  const travellers = travellerCount(trip.who);
  const meta = [
    whenPart,
    travellers !== null ? metaCopy.travellers(travellers) : null,
    trip.budget !== null && trip.budget !== "any" ? metaCopy.budgetTiers[trip.budget] : null,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(metaCopy.separator);
  return (
    <button
      type="button"
      data-up-next-card
      onClick={onOpen}
      aria-label={trip.name}
      className="draft-discovery-card group relative block h-59 w-full overflow-hidden rounded-[1.75rem] bg-gray-900 text-left shadow-[0_2px_8px_rgb(0_0_0/0.08)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgb(0_0_0/0.16)]"
    >
      <img
        src={cover.src}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
        style={{ objectPosition: cover.focalPoint }}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-black/10"
      />

      {countdown !== null && (
        <span className="absolute left-4 top-4 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-gray-900 shadow-sm backdrop-blur-sm">
          {countdown}
        </span>
      )}
      {pending > 0 && (
        <span className="absolute right-4 top-4 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-950 shadow-sm">
          {T.waitingOnYou(pending)}
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 px-5 pb-5">
        <span className="block truncate text-[1.4rem] font-bold leading-7 text-white">
          {trip.name}
        </span>
        {meta !== "" && (
          <span className="mt-1.5 block text-[13px] leading-snug text-white/90">{meta}</span>
        )}
        <span className="mt-1 block truncate text-xs text-white/65">
          {[chats > 0 ? T.chats(chats) : null, T.updated(formatMonthDay(trip.updatedAt, locale))]
            .filter((part): part is string => part !== null)
            .join(" \u00b7 ")}
        </span>
      </span>
    </button>
  );
}

/** Display name of the Session's Agent; a Session may outlive its Agent. */
function resolveAgentName(agents: readonly AgentSummary[], agentId: string): string {
  const agent = agents.find((a) => a.agentId === agentId);
  return agent ? agentDisplayName(agent) : agentId;
}

function SessionCard({
  session,
  agentName,
  date,
  cover,
  onOpen,
}: {
  session: SessionInfo;
  agentName: string;
  date: string;
  cover: TravelCoverAsset;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-session-card
      data-rail-card
      onClick={onOpen}
      className="draft-discovery-card group relative h-41 w-41 shrink-0 snap-start overflow-hidden rounded-3xl bg-gray-900 text-left shadow-[0_2px_8px_rgb(0_0_0/0.08)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgb(0_0_0/0.16)]"
    >
      <img
        src={cover.src}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
        style={{ objectPosition: cover.focalPoint }}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-black/80 via-black/15 to-black/5"
      />

      {session.pendingApprovalCount > 0 ? (
        <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-amber-300 px-2 py-0.5 text-[10.5px] font-semibold text-amber-950 shadow-sm">
          {S.chat.pendingApprovals(session.pendingApprovalCount)}
        </span>
      ) : session.status === "running" ? (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-gray-900 shadow-sm backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {S.chat.statusRunning}
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-0 px-3.5 pb-3.5">
        <span className="block line-clamp-2 text-[13px] font-semibold leading-[1.3] text-white">
          {session.title ?? S.chat.defaultSessionTitle}
        </span>
        <span className="mt-1 block truncate text-[10.5px] text-white/75">{`${agentName} · ${date}`}</span>
      </span>
    </button>
  );
}

function InspirationCard({
  title,
  tag,
  cover,
  busy,
  disabled,
  onOpen,
}: {
  title: string;
  tag: string;
  cover: TravelCoverAsset;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-rail-card
      title={title}
      aria-label={title}
      aria-busy={busy}
      disabled={disabled}
      onClick={onOpen}
      className="draft-discovery-card group relative h-52 w-52 shrink-0 snap-start overflow-hidden rounded-[1.75rem] bg-gray-900 text-left shadow-[0_2px_8px_rgb(0_0_0/0.08)] transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgb(0_0_0/0.16)] disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0"
    >
      <img
        src={cover.src}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        style={{ objectPosition: cover.focalPoint }}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-black/80 via-black/10 to-black/10"
      />
      <span className="absolute left-4 top-4 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-900 shadow-sm backdrop-blur-sm">
        {busy ? S.common.loading : tag}
      </span>
      <span className="absolute inset-x-0 bottom-0 px-5 pb-5">
        <span className="block line-clamp-2 text-base font-semibold leading-5 text-white">
          {title}
        </span>
      </span>
    </button>
  );
}
