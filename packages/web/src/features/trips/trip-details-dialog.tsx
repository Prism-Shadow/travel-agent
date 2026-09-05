/** The person's shared Trip identity and notes; the model-owned itinerary is not edited here. */
import { useId, useRef, useState } from "react";
import type { TripCreateRequest, TripSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useTrips } from "../../state/trips";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { TripConstraintChips } from "../chat/trip-constraint-chips";
import { constraintsToTripPatch, tripToConstraints } from "../chat/trip-constraints";
import type { TripConstraints } from "../chat/trip-constraints";

export function TripDetailsFields({
  name,
  setName,
  constraints,
  setConstraints,
  notes,
  setNotes,
}: {
  name: string;
  setName: (value: string) => void;
  constraints: TripConstraints;
  setConstraints: (value: TripConstraints) => void;
  notes: string;
  setNotes: (value: string) => void;
}) {
  const T = S.trip.flow;
  return (
    <div className="space-y-5">
      <Input
        label={T.name}
        aria-label={T.name}
        value={name}
        maxLength={120}
        autoFocus
        required
        placeholder={T.namePlaceholder}
        onChange={(event) => setName(event.target.value)}
      />
      <div>
        <p className="mb-3 text-xs leading-5 text-gray-500 dark:text-gray-400">{T.sharedHint}</p>
        <TripConstraintChips value={constraints} onChange={setConstraints} />
      </div>
      <Textarea
        label={T.notes}
        aria-label={T.notes}
        value={notes}
        maxLength={8000}
        rows={4}
        placeholder={T.notesPlaceholder}
        onChange={(event) => setNotes(event.target.value)}
      />
    </div>
  );
}

export function TripDetailsDialog({ trip, onClose }: { trip: TripSummary; onClose: () => void }) {
  const formId = useId();
  const { patch } = useTrips();
  const [initial] = useState(trip);
  const [name, setName] = useState(trip.name);
  const [constraints, setConstraints] = useState(() => tripToConstraints(trip));
  const [notes, setNotes] = useState(trip.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const save = async () => {
    if (pending.current) return;
    if (!name.trim()) {
      setError(S.trip.flow.nameRequired);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const body: TripCreateRequest = constraintsToTripPatch(
        constraints,
        tripToConstraints(initial),
      );
      if (name.trim() !== initial.name) body.name = name.trim();
      if (notes.trim() !== (initial.notes ?? "")) body.notes = notes.trim();
      if (Object.keys(body).length) await patch(trip.tripId, body);
      onClose();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={S.trip.flow.sharedTitle}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? S.common.loading : S.common.save}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        aria-label={S.trip.flow.sharedTitle}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="min-w-0">
          <TripDetailsFields {...{ name, setName, constraints, setConstraints, notes, setNotes }} />
        </fieldset>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
