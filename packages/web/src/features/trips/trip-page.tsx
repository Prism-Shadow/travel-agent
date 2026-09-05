/**
 * Trip page: the journey's identity, its conversations, and the itinerary the agent wrote.
 *
 * What this page is *not* is as important as what it is. It does not edit `itinerary.md` — that
 * file belongs to the model, and this application renders it. It does not keep a booking or
 * receipt ledger: the run stops at the payment page and cannot observe the outcome, so a record
 * claiming a booking exists would be a guess. And it is not a planning hub with modules to fill
 * in; the journey's plan is one document, written by the agent as the work happens.
 *
 * The folder path is shown deliberately. A trip is a folder on the person's own disk, which they
 * can open, back up and keep after uninstalling this application — the page states where it is
 * rather than hiding it behind the abstraction.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { SessionInfo, TripItineraryResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatMonthDay } from "../../lib/format";
import { useLocale } from "../../state/locale";
import { apiErrorText } from "../../lib/api-error";
import { tripMetaLine } from "../../lib/trip-format";
import { tripDisplayName, useTrips } from "../../state/trips";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { useStartConversation } from "../chat/use-start-conversation";
import { TripDetailsDialog } from "./trip-details-dialog";
import { useSessions } from "../../state/sessions";
import { selectTravelCovers } from "../../lib/travel-cover-library";
import { Md } from "../chat/md";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";

export function TripPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const startConversation = useStartConversation();
  const { sessions: indexedSessions } = useSessions();
  const [editing, setEditing] = useState(false);
  const {
    byId,
    loading: tripsLoading,
    error: tripsError,
    reload: reloadTrips,
    patch,
    remove,
  } = useTrips();
  const { lang } = useLocale();
  const dateLocale = lang === "en" ? "en" : "zh";
  const trip = tripId === undefined ? undefined : byId.get(tripId);

  const [details, setDetails] = useState<{
    tripId: string;
    sessions: SessionInfo[];
    itinerary: TripItineraryResponse;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const sessions = details && details.tripId === tripId ? details.sessions : null;
  const itinerary = details && details.tripId === tripId ? details.itinerary : null;
  const membership = indexedSessions
    .filter((s) => s.tripId === tripId)
    .map((s) => s.sessionId)
    .join(",");
  const [renaming, setRenaming] = useState(false);
  const [nameText, setNameText] = useState("");
  const [deleting, setDeleting] = useState(false);

  /**
   * Relative image names in `itinerary.md` point at files in the trip's folder. Absolute and
   * data URLs are left alone: this resolves the document's own neighbours, it does not decide
   * what the document may reference.
   */
  const resolveTripImage = useCallback(
    (src: string) => {
      if (tripId === undefined) return src;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return src;
      return api.tripFileUrl(tripId, src.replace(/^\.\//, ""));
    },
    [tripId],
  );

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    setLoadError(null);
    void Promise.all([api.listTripSessions(tripId), api.getTripItinerary(tripId)])
      .then(([s, itinerary]) => {
        if (!cancelled) setDetails({ tripId, sessions: s.sessions, itinerary });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, membership, retry]);

  const backLink = (
    <Link
      to="/trips"
      className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      <ArrowLeftIcon size={17} aria-hidden />
      {S.trip.backToTrips}
    </Link>
  );

  // A trip deleted in another window, or an id that was never real: say so instead of
  // rendering an empty shell that looks like a loading state that never finishes.
  if (trip === undefined) {
    return (
      <div className="mx-auto h-full max-w-4xl overflow-y-auto px-5 py-7 sm:px-8">
        {backLink}
        {tripsLoading ? (
          <SkeletonList rows={4} />
        ) : (
          <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
            {tripsError ? S.trip.flow.loadingError : S.trip.notFound}
          </p>
        )}
        {tripsError && (
          <Button className="mt-4 mr-2" onClick={() => void reloadTrips()}>
            {S.trip.overview.retry}
          </Button>
        )}
      </div>
    );
  }

  const name = tripDisplayName(trip, S.trip.untitled);
  const meta = tripMetaLine(trip, S.trip.meta);

  const confirmRename = async () => {
    const next = nameText.trim();
    if (!next) return;
    try {
      await patch(trip.tripId, { name: next });
      setRenaming(false);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const confirmDelete = async () => {
    try {
      await remove(trip.tripId);
      navigate("/trips");
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-5 py-7 sm:px-8">
      {backLink}
      <div className="relative mb-7 h-44 overflow-hidden rounded-2xl bg-gray-100 sm:h-52 dark:bg-gray-800">
        <img
          className="h-full w-full object-cover"
          src={
            selectTravelCovers([
              { sessionId: trip.tripId, title: trip.name || trip.destination },
            ])[0]!.src
          }
          alt=""
        />
      </div>
      <header>
        {renaming ? (
          <div className="flex items-center gap-2">
            <Input
              value={nameText}
              autoFocus
              onChange={(e) => setNameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmRename();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
            <Button onClick={() => void confirmRename()}>{S.common.save}</Button>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {S.common.cancel}
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <h1 className="min-w-0 flex-1 break-words text-2xl font-semibold">{name}</h1>
            <Button
              variant="ghost"
              onClick={() => {
                setNameText(trip.name);
                setRenaming(true);
              }}
            >
              {S.trip.rename}
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              {S.trip.deleteTrip}
            </Button>
          </div>
        )}
        {meta !== "" && <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{meta}</p>}

        {/* The folder is the person's; naming it is the point, not an implementation leak. */}
        <p className="mt-3 break-all font-mono text-xs text-gray-400 dark:text-gray-500">
          {trip.dir}
        </p>
        {!trip.dirExists && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
            {S.trip.folderMissingShort}
          </p>
        )}
      </header>

      <section className="mt-7 border-b border-gray-200 pb-6 dark:border-gray-800">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{S.trip.flow.sharedTitle}</h2>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {S.trip.flow.edit}
          </Button>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600 dark:text-gray-400">
          {trip.notes || S.trip.flow.noNotes}
        </p>
        <p className="mt-2 text-xs leading-5 text-gray-400 dark:text-gray-500">
          {S.trip.flow.sharedHint}
        </p>
      </section>
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{S.trip.conversations}</h2>
          <Button onClick={() => startConversation(trip.tripId)}>
            <PlusIcon size={16} aria-hidden />
            {S.trip.flow.newTopic}
          </Button>
        </div>
        <p className="mb-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {S.trip.flow.topicsHint}
        </p>
        {loadError ? (
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadError}
            <Button className="ml-3" onClick={() => setRetry((n) => n + 1)}>
              {S.trip.overview.retry}
            </Button>
          </div>
        ) : sessions === null ? (
          <SkeletonList rows={2} />
        ) : sessions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400 dark:text-gray-600">{S.trip.noConversations}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {sessions.map((s) => (
              <li key={s.sessionId}>
                <button
                  type="button"
                  onClick={() => navigate(`/chat/${s.sessionId}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  <Truncated
                    text={s.title ?? S.chat.defaultSessionTitle}
                    className="min-w-0 flex-1 text-sm"
                  />
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {formatMonthDay(s.createdAt, dateLocale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {S.trip.itinerary}
          </h2>
          {itinerary?.updatedAt !== undefined && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {S.trip.itineraryUpdated(formatMonthDay(itinerary.updatedAt, dateLocale))}
            </span>
          )}
        </div>
        {loadError ? (
          <p className="mt-2 text-sm text-gray-500">{S.trip.flow.loadingError}</p>
        ) : itinerary === null ? (
          <SkeletonList rows={3} />
        ) : itinerary.exists ? (
          // `md-body` is the repository's one markdown stylesheet (styles.css) — the same one
          // the transcript uses, so an itinerary reads here exactly as it does in the reply
          // that produced it.
          <article className="md-body mt-3 text-base leading-relaxed text-gray-800 dark:text-gray-100">
            {/* Images in the itinerary are files beside it in the trip's own folder — a map
                the agent rendered, a screenshot it kept — so relative names resolve there. */}
            <Md text={itinerary.markdown} resolveImageSrc={resolveTripImage} />
          </article>
        ) : (
          // Not an error: the agent writes this file as the work produces something worth
          // keeping, so an empty journey simply has no plan yet.
          <p className="mt-2 text-sm text-gray-400 dark:text-gray-600">{S.trip.noItinerary}</p>
        )}
      </section>

      {editing && <TripDetailsDialog trip={trip} onClose={() => setEditing(false)} />}

      <ConfirmModal
        open={deleting}
        title={S.trip.deleteTrip}
        confirmLabel={S.common.delete}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(false)}
      >
        {/* The folder survives deletion, and so do the conversations: say both, because the
            person is deciding whether this is destructive. */}
        {S.trip.deleteTripConfirm(name)}
      </ConfirmModal>
    </div>
  );
}
