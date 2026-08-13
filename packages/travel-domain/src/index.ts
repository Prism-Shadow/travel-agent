/**
 * Travel domain logic.
 *
 * Everything here depends on the *meaning* of a trip — what a fare is, what makes two options
 * comparable, why one is worth showing. The browser layer and the transaction layer know none
 * of it, and that separation is what lets either be replaced without touching this.
 */
export {
  paretoFrontier,
  selectRepresentatives,
  type Candidate,
  type FacetClaim,
  type Objective,
  type Representative,
  type SelectOptions,
} from "./representatives.js";

export {
  affinity,
  alignOffers,
  identityByJudgement,
  identityByKey,
  type AlignedOffer,
  type AlignmentResult,
  type AmbiguousPair,
  type Identity,
  type Offer,
  type SameThingVerdict,
} from "./alignment.js";

export {
  submitBooking,
  type BookingResult,
  type RefusalReason,
  type SubmitBookingOptions,
} from "./booking.js";
