/** Trip membership stays separate from chat history, browser state and engine controls. */
import { useState } from "react";
import { Link } from "react-router";
import { SuitcaseSimpleIcon } from "@phosphor-icons/react/dist/csr/SuitcaseSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { tripDisplayName, useTrips } from "../../state/trips";
import { Button } from "../../components/ui/button";
import { useStartConversation } from "../chat/use-start-conversation";
import { JoinTripDialog } from "./join-trip-dialog";
import { TripDetailsDialog } from "./trip-details-dialog";

export function ConversationTripBar({ session }: { session: SessionInfo }) {
  const { byId, loading, error, reload } = useTrips();
  const trip = session.tripId ? byId.get(session.tripId) : null;
  const [joining, setJoining] = useState(false);
  const [editing, setEditing] = useState(false);
  const start = useStartConversation();
  const T = S.trip.flow;
  return (
    <>
      <div
        data-conversation-trip
        className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/60 px-4 py-2 text-xs dark:border-gray-800 dark:bg-gray-900/50"
      >
        {trip ? (
          <>
            <Link
              to={`/trips/${trip.tripId}`}
              className="flex min-w-0 items-center gap-2 font-medium text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white"
            >
              <SuitcaseSimpleIcon size={16} aria-hidden />
              <span className="max-w-64 truncate">{tripDisplayName(trip, S.trip.untitled)}</span>
            </Link>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {T.edit}
              </Button>
              <Button size="sm" onClick={() => start(trip.tripId, session.agentId)}>
                <PlusIcon size={14} aria-hidden />
                {T.newTopic}
              </Button>
            </div>
          </>
        ) : session.tripId && (loading || error) ? (
          <>
            <span role="status">{loading ? S.common.loading : T.loadingError}</span>
            {error && (
              <Button size="sm" onClick={() => void reload()}>
                {S.trip.overview.retry}
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="text-gray-500 dark:text-gray-400">{T.loose}</span>
            <Button size="sm" onClick={() => setJoining(true)}>
              <SuitcaseSimpleIcon size={15} aria-hidden />
              {T.add}
            </Button>
          </>
        )}
      </div>
      {joining && <JoinTripDialog session={session} onClose={() => setJoining(false)} />}
      {editing && trip && <TripDetailsDialog trip={trip} onClose={() => setEditing(false)} />}
    </>
  );
}
