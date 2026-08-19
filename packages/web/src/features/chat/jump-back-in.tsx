/**
 * Image-first discovery column on the draft screen: recent Sessions live in "Jump back
 * in", while "Get inspired" is always available for first-time and returning users. It
 * reuses the Sessions context already loaded for the sidebar and the local generated cover
 * catalog, so neither rail adds a fetch to the welcome screen.
 *
 * The layout follows the image-first grammar of the Mindtrip reference: nearly-square
 * covers, a quiet readability scrim, bottom-aligned copy, and a visible slice of the next
 * card. The generated travel photographs are matched from the local cover catalog and
 * deduplicated across the visible cards; they never pretend to be evidence from the
 * conversation itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";
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

/** Three cards keep the rail useful without duplicating the sidebar as another long list. */
const RAIL_SIZE = 3;

export const INSPIRATION_CARDS = [
  { id: "kyotoAutumn", coverId: "kyoto-temple" },
  { id: "bangkokFood", coverId: "food-market" },
  { id: "northernLights", coverId: "northern-lights" },
] as const;

const INSPIRATION_COVER_IDS: ReadonlySet<string> = new Set(
  INSPIRATION_CARDS.map((card) => card.coverId),
);

export type InspirationCardId = (typeof INSPIRATION_CARDS)[number]["id"];

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
  const { agents } = useProject();

  // Newest-first across all Agents (the context's flat list interleaves per-Agent pages).
  // ISO-8601 strings order lexicographically, so a string compare is the date sort.
  const recent = useMemo(
    () =>
      sessions
        .filter((s) => sessionCategory(s) === "active")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, RAIL_SIZE),
    [sessions],
  );
  const covers = useMemo(
    () =>
      selectTravelCovers(
        recent.map((session) => ({
          sessionId: session.sessionId,
          title: session.title,
        })),
        TRAVEL_COVER_CATALOG,
        { excludedIds: INSPIRATION_COVER_IDS },
      ),
    [recent],
  );
  const recentRail = useHorizontalRail(recent.length);
  const inspirationRail = useHorizontalRail(INSPIRATION_CARDS.length);

  return (
    <aside className="draft-jump-back-in hidden w-84 shrink-0 flex-col justify-center pb-14 xl:flex">
      <div className="flex flex-col gap-8">
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
                    cover={covers[index]!}
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
      className="draft-discovery-card group relative h-52 w-52 shrink-0 snap-start overflow-hidden rounded-[1.75rem] bg-gray-900 text-left shadow-[0_2px_8px_rgb(0_0_0/0.08)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgb(0_0_0/0.16)]"
    >
      <img
        src={cover.src}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
        style={{ objectPosition: cover.focalPoint }}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-black/80 via-black/15 to-black/5"
      />

      {session.pendingApprovalCount > 0 ? (
        <span className="absolute left-4 top-4 inline-flex items-center rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-950 shadow-sm">
          {S.chat.pendingApprovals(session.pendingApprovalCount)}
        </span>
      ) : session.status === "running" ? (
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-900 shadow-sm backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {S.chat.statusRunning}
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-0 px-5 pb-5">
        <span className="block line-clamp-2 text-base font-semibold leading-5 text-white">
          {session.title ?? S.chat.defaultSessionTitle}
        </span>
        <span className="mt-1.5 block truncate text-xs text-white/75">{`${agentName} · ${date}`}</span>
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
