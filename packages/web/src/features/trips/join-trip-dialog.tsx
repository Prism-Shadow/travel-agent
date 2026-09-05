/** Explicit membership change. A confirmed create is reused if attachment needs a retry. */
import { useId, useRef, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { tripDisplayName, useTrips } from "../../state/trips";
import { useSessions } from "../../state/sessions";
import { tripMetaLine } from "../../lib/trip-format";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { TripDetailsFields } from "./trip-details-dialog";
import { EMPTY_TRIP_CONSTRAINTS, constraintsToTripPatch } from "../chat/trip-constraints";

export function JoinTripDialog({
  session,
  onClose,
}: {
  session: SessionInfo;
  onClose: () => void;
}) {
  const formId = useId();
  const { trips, create, loading, error: loadError, reload } = useTrips();
  const { replace } = useSessions();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [target, setTarget] = useState("");
  const [name, setName] = useState((session.title ?? "").slice(0, 120));
  const [constraints, setConstraints] = useState(EMPTY_TRIP_CONSTRAINTS);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const createdId = useRef<string | null>(null);
  const T = S.trip.flow;
  const join = async () => {
    if (pending.current) return;
    if (mode === "new" && !name.trim()) {
      setError(T.nameRequired);
      return;
    }
    if (mode === "existing" && !target) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      let id = target;
      if (mode === "new") {
        const trip = await create({
          name: name.trim(),
          notes: notes.trim(),
          ...constraintsToTripPatch(constraints),
        });
        id = trip.tripId;
        createdId.current = id;
        setTarget(id);
        setMode("existing");
      }
      const result = await api.setSessionTrip(session.sessionId, id);
      replace(result.session);
      onClose();
    } catch (e) {
      setError((createdId.current ? `${T.attachFailed} ` : "") + apiErrorText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={T.joinTitle}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      widthClass="sm:max-w-lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>
            {T.keepChatting}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || (mode === "existing" && (!target || loading || loadError))}
          >
            {busy ? S.common.loading : mode === "new" ? T.createAndJoin : T.joinAndContinue}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm leading-6 text-gray-500 dark:text-gray-400">{T.joinDescription}</p>
      <form
        id={formId}
        aria-label={T.joinTitle}
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <fieldset disabled={busy} className="min-w-0">
          <div
            role="group"
            aria-label={T.joinTitle}
            className="mb-5 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
          >
            {(["new", "existing"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setError("");
                }}
                className={`flex-1 rounded-md px-2 py-2 text-sm ${mode === value ? "bg-white shadow-sm dark:bg-gray-900" : "text-gray-500 dark:text-gray-400"}`}
              >
                {T[value]}
              </button>
            ))}
          </div>
          {mode === "new" ? (
            <TripDetailsFields
              {...{ name, setName, constraints, setConstraints, notes, setNotes }}
            />
          ) : loading ? (
            <p role="status">{S.common.loading}</p>
          ) : loadError ? (
            <div>
              <p role="alert">{T.loadingError}</p>
              <Button className="mt-3" onClick={() => void reload()}>
                {S.trip.overview.retry}
              </Button>
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">{T.chooseTrip}</legend>
              {trips.length ? (
                trips.map((trip) => (
                  <label
                    key={trip.tripId}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"
                  >
                    <input
                      type="radio"
                      name="trip"
                      value={trip.tripId}
                      checked={target === trip.tripId}
                      onChange={() => setTarget(trip.tripId)}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium">
                        {tripDisplayName(trip, S.trip.untitled)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {tripMetaLine(trip, S.trip.meta)}
                      </span>
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-gray-500">{T.noTargets}</p>
              )}
            </fieldset>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-gray-400 dark:text-gray-500">{T.filesHint}</p>
      </form>
    </Modal>
  );
}
