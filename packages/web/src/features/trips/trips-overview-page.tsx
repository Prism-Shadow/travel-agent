/** The person's trips, grouped by known dates. All content comes from the loaded indexes. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { SuitcaseSimpleIcon } from "@phosphor-icons/react/dist/csr/SuitcaseSimple";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { TripSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import {
  calendarDate,
  daysUntil,
  groupTripsForOverview,
  localTodayIso,
  tripWindow,
} from "../../lib/trip-order";
import { tripMetaLine, whenText } from "../../lib/trip-format";
import { selectTravelCovers, type TravelCoverAsset } from "../../lib/travel-cover-library";
import { sessionCategory } from "../../lib/session-grouping";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";
import { useSessions } from "../../state/sessions";
import { tripDisplayName, useTrips } from "../../state/trips";
import { parkActiveDraft } from "../chat/draft-sessions";
import { SkeletonList } from "../../components/ui/skeleton";
import "./trips-overview.css";

/** Refresh on local midnight and on return to a sleeping tab, without fetching another index. */
function useToday() {
  const [today, setToday] = useState(localTodayIso);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setToday(localTodayIso());
      clearTimeout(timer);
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(update, midnight.getTime() - Date.now() + 100);
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}

function NewTripButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="trips-new-button" onClick={onClick}>
      <SuitcaseSimpleIcon size={22} aria-hidden />
      {S.trip.overview.newTrip}
    </button>
  );
}

export function TripsOverviewPage() {
  const { trips, loading, error, reload } = useTrips();
  const { sessions } = useSessions();
  const { user } = useAuth();
  const { currentProject, agents, setCurrentAgentId } = useProject();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const today = useToday();
  const T = S.trip.overview;
  const groups = useMemo(() => groupTripsForOverview(trips, today), [trips, today]);
  const covers = useMemo(() => {
    // Reserve the whole list, including collapsed history, so expanding it cannot change covers.
    const ordered = [...groups.upcoming, ...groups.unscheduled, ...groups.past];
    const selected = selectTravelCovers(
      ordered.map((trip) => ({
        sessionId: trip.tripId,
        title: trip.name.trim() || trip.destination,
      })),
    );
    return new Map(ordered.map((trip, index) => [trip.tripId, selected[index]!]));
  }, [groups]);
  const pending = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (session.tripId && sessionCategory(session) === "active") {
        counts.set(
          session.tripId,
          (counts.get(session.tripId) ?? 0) + session.pendingApprovalCount,
        );
      }
    }
    return counts;
  }, [sessions]);
  const newTrip = () => {
    if (user && currentProject) parkActiveDraft(user.userId, currentProject.projectId);
    const agentId = (agents.find((agent) => agent.agentId === "default_agent") ?? agents[0])
      ?.agentId;
    if (agentId) setCurrentAgentId(agentId);
    navigate("/chat/new", { state: { tripId: null, ...(agentId ? { agentId } : {}) } });
  };
  const card = (trip: TripSummary, featured = false) => (
    <OverviewCard
      key={trip.tripId}
      trip={trip}
      cover={covers.get(trip.tripId)!}
      pending={pending.get(trip.tripId) ?? 0}
      featured={featured}
      today={today}
      locale={locale}
    />
  );
  const started = groups.upcoming.some(
    (trip) =>
      trip.when?.kind === "dates" &&
      !!calendarDate(trip.when.start) &&
      trip.when.start.trim() < today,
  );

  return (
    <div className="trips-overview h-full overflow-y-auto" data-trips-overview>
      <div className="trips-overview-inner">
        <header className="trips-overview-header">
          <div>
            <h1>{T.title}</h1>
            <p>{T.subtitle}</p>
          </div>
          <NewTripButton onClick={newTrip} />
        </header>

        {loading ? (
          <section role="status" aria-label={T.loading} className="trips-load-state">
            <SkeletonList rows={5} />
            <span className="sr-only">{T.loading}</span>
          </section>
        ) : error ? (
          <section className="trips-load-state text-center">
            <p role="alert">{T.loadError}</p>
            <button className="trips-new-button mx-auto mt-5" onClick={() => void reload()}>
              {T.retry}
            </button>
          </section>
        ) : trips.length === 0 ? (
          <section className="trips-empty" aria-labelledby="trips-empty-title">
            <img src="/trips/empty-background.webp" alt="" className="trips-empty-background" />
            <div className="trips-empty-copy">
              <h2 id="trips-empty-title">{T.emptyTitle}</h2>
              <p>{T.emptyDescription}</p>
              <NewTripButton onClick={newTrip} />
              <p className="trips-empty-hint">{T.emptyHint}</p>
            </div>
          </section>
        ) : (
          <div className="trips-sections">
            {groups.upcoming.length > 0 && (
              <section aria-labelledby="trips-upcoming-heading" data-trip-section="upcoming">
                <h2 id="trips-upcoming-heading" className="trips-section-heading">
                  {started ? T.underwayAndUpcoming : T.upcoming}
                  <span>{groups.upcoming.length}</span>
                </h2>
                <div
                  className={`trips-focus-grid ${groups.upcoming.length === 1 ? "trips-focus-solo" : ""}`}
                >
                  {groups.upcoming.slice(0, 3).map((trip, index) => card(trip, index === 0))}
                </div>
                {groups.upcoming.length > 3 && (
                  <div className="trips-card-grid mt-6">
                    {groups.upcoming.slice(3).map((trip) => card(trip))}
                  </div>
                )}
              </section>
            )}
            {groups.unscheduled.length > 0 && (
              <section aria-labelledby="trips-unscheduled-heading" data-trip-section="unscheduled">
                <h2 id="trips-unscheduled-heading" className="trips-section-heading">
                  {T.unscheduled}
                  <span>{groups.unscheduled.length}</span>
                </h2>
                <div className="trips-card-grid">
                  {groups.unscheduled.map((trip) => card(trip))}
                </div>
              </section>
            )}
            {groups.past.length > 0 && (
              <details className="trips-past group" data-trip-section="past">
                <summary>
                  <h2 className="trips-section-heading">
                    {T.past}
                    <span>{groups.past.length}</span>
                  </h2>
                  <span className="trips-past-preview">
                    {[
                      tripDisplayName(groups.past[0]!, S.trip.untitled),
                      whenText(groups.past[0]!.when, overviewMetaCopy(locale, today)),
                    ]
                      .filter(Boolean)
                      .join(S.trip.meta.separator)}
                  </span>
                  <CaretRightIcon
                    size={20}
                    aria-hidden
                    className="shrink-0 transition-transform group-open:rotate-90"
                  />
                </summary>
                <div className="trips-card-grid pb-7">{groups.past.map((trip) => card(trip))}</div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function overviewMetaCopy(locale: "zh" | "en", today: string) {
  const date = (iso: string) => {
    const valid = calendarDate(iso);
    if (!valid) return iso;
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      ...(valid.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    }).format(new Date(`${valid}T12:00:00`));
  };
  return {
    ...S.trip.meta,
    dateRange: (start: string, end: string) => `${date(start)} – ${date(end)}`,
    dateFrom: (start: string) => S.trip.meta.dateFrom(date(start)),
    dateUntil: (end: string) => S.trip.meta.dateUntil(date(end)),
  };
}

function OverviewCard({
  trip,
  cover,
  featured,
  pending,
  today,
  locale,
}: {
  trip: TripSummary;
  cover: TravelCoverAsset;
  featured: boolean;
  pending: number;
  today: string;
  locale: "zh" | "en";
}) {
  const T = S.trip.overview;
  const name = tripDisplayName(trip, S.trip.untitled);
  const meta =
    tripMetaLine({ ...trip, destination: "" }, overviewMetaCopy(locale, today)) || T.datesNotSet;
  const start = trip.when?.kind === "dates" ? calendarDate(trip.when.start) : null;
  const end = trip.when?.kind === "dates" ? calendarDate(trip.when.end) : null;
  const days = start && tripWindow(trip) ? daysUntil(start, today) : null;
  const status =
    days === null
      ? null
      : days < 0
        ? end && end >= today
          ? T.inProgress
          : end === null
            ? T.departed
            : null
        : days === 0
          ? S.chat.upNext.departsToday
          : days === 1
            ? S.chat.upNext.departsTomorrow
            : S.chat.upNext.departsInDays(days);
  return (
    <Link
      to={`/trips/${trip.tripId}`}
      aria-label={name}
      data-trip-card={trip.tripId}
      className={`trips-card ${featured ? "trips-card-featured" : "trips-card-compact"}`}
    >
      <img
        src={cover.src}
        alt=""
        loading={featured ? "eager" : "lazy"}
        decoding="async"
        style={{ objectPosition: cover.focalPoint }}
      />
      {featured && status && <span className="trips-countdown">{status}</span>}
      <div className="trips-card-content">
        <div className="min-w-0 flex-1">
          <div className="trips-card-title-row">
            <h3 title={name}>{name}</h3>
            {pending > 0 && (
              <span className="trips-waiting">{S.chat.upNext.waitingOnYou(pending)}</span>
            )}
          </div>
          <p className="trips-card-meta">
            {featured
              ? meta
              : meta.split(S.trip.meta.separator).map((part, index) => (
                  <span className="block" key={index}>
                    {part}
                  </span>
                ))}
          </p>
          {!featured && status && days !== null && days < 0 && (
            <p className="trips-card-status">{status}</p>
          )}
        </div>
        {featured ? (
          <span className="trips-view-action">
            {T.viewTrip}
            <ArrowRightIcon size={19} aria-hidden />
          </span>
        ) : (
          <CaretRightIcon size={19} aria-hidden className="trips-card-arrow shrink-0" />
        )}
      </div>
    </Link>
  );
}
