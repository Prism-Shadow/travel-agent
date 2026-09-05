/** Resolve membership and identity at send time, including changes from another window. */
import type { TaskInputPart, TripCurrency } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { applySharedTrip } from "./trip-constraints";

export async function sessionTripInput(
  sessionId: string,
  input: TaskInputPart[],
  currency: TripCurrency,
) {
  const { session } = await api.getSession(sessionId);
  if (!session.tripId) return input;
  const { trip } = await api.getTrip(session.tripId);
  return applySharedTrip(input, trip, S.chat.tripChips, currency);
}
