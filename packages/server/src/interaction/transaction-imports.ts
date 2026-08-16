/**
 * One import surface for the transaction layer, so the rest of this directory names it once.
 *
 * Two things are worth the indirection. The server is otherwise free of travel-product packages,
 * and keeping the dependency visible in a single file makes it obvious what a merge from upstream
 * would have to reconcile. And `FeatureFlagsShape` is declared here structurally rather than
 * imported from core: the interaction layer only ever *reads* one flag, and depending on the whole
 * flag union for that would tie this module to core's release cadence for no benefit.
 */
export {
  buildInteraction,
  escalationKindFor,
  openJournal,
  paymentSummaryDigest,
  planFromSummary,
  CheckpointStore,
  DanglingIntentError,
  DEFAULT_CONFIRMATION_TTL_MS,
  DEFAULT_INTERACTION_TIMEOUT_MS,
  Journal,
} from "@travel-agent/transaction";

export type {
  ApprovedTolerance,
  Checkpoint,
  Commitment,
  Escalation,
  EscalationChannel,
  EscalationOutcome,
  InteractionInput,
  InteractionKind,
  InteractionOutcome,
  PaymentSummary,
  SecretField,
  TaskStage,
  UserInteraction,
} from "@travel-agent/transaction";

/** The one flag the interaction layer reads. Structural, so no import of core's flag union. */
export interface FeatureFlagsShape {
  "payments.agent_click_pay": boolean;
  "secret_entry.contract": boolean;
  "secret_entry.live": boolean;
}
