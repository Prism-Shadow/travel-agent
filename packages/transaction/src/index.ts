/**
 * Transactional semantics for agents that take irreversible actions.
 *
 * Five pieces, each answering one question that "run the loop until the model stops" cannot:
 *
 * | Module | Question |
 * | --- | --- |
 * | {@link Journal} | Did this already happen? (write-ahead log, replay recovery) |
 * | {@link Commitment} | Is this still what they agreed to? (drift against an approved plan) |
 * | {@link CheckpointStore} | Where did the task get to? (resume after a handoff or a crash) |
 * | {@link Escalation} | How do I reach someone who is not watching? (typed, with a lapse policy) |
 * | {@link submitBooking} | May this irreversible act happen *now*? (the five gates, in order) |
 *
 * Everything here exists because **the model is inside the threat model**. These are not judgements
 * an agent makes badly and could be taught to make well — they are the checks that must hold even
 * when the agent is confused or has been talked into something by a page it read. Asking the agent
 * whether it is allowed to spend the money is not a check; it is the same thing auditing itself.
 * That line is what decides whether something belongs here: judgement stays with the model, and
 * only enforcement is written down as code.
 *
 * Nothing here knows about browsers, travel, or any particular messaging app. `submitBooking` is
 * named for the case that motivated it but is domain-neutral — it takes an action name and a
 * callback, and would guard a refund or a file deletion identically. Keeping the package free of
 * any one domain is what would let it move into PenguinHarness itself: any agent that spends money
 * needs exactly this and nothing narrower.
 */
export {
  Journal,
  openJournal,
  deriveKey,
  DanglingIntentError,
  type JournalEntry,
  type JournalOp,
  type JournalOpState,
} from "./journal.js";

export {
  checkDrift,
  permits,
  describeDrift,
  type AuthorityCeiling,
  type Commitment,
  type Drift,
  type DriftCheck,
  type Tolerance,
} from "./commitment.js";

export { CheckpointStore, type Checkpoint, type TaskStage } from "./checkpoint.js";

export {
  escalation,
  newEscalationId,
  type Escalation,
  type EscalationChannel,
  type EscalationKind,
  type EscalationOption,
  type EscalationOutcome,
  type TimeoutPolicy,
} from "./escalation.js";

export {
  assertCarriesNoValue,
  assertCompleteSummary,
  buildInteraction,
  escalationKindFor,
  isNeverFillable,
  newInteractionId,
  touchesBrowser,
  DEFAULT_CONFIRMATION_TTL_MS,
  DEFAULT_INTERACTION_TIMEOUT_MS,
  type ApprovedTolerance,
  type BrowserTakeoverInteraction,
  type CommitmentConfirmationInteraction,
  type HumanChallengeInteraction,
  type InfoRequestInteraction,
  type InteractionInput,
  type InteractionKind,
  type InteractionOutcome,
  type PaymentSummary,
  type SecretEntryInteraction,
  type SecretField,
  type SelectionInteraction,
  type UserInteraction,
} from "./interaction.js";

export {
  applyHandoverEvent,
  mayRead,
  mayWrite,
  refuseIfNotPermitted,
  HandoverTransitionError,
  HANDOVER_DRAIN_MS,
  INITIAL_HANDOVER,
  type ControlRefusal,
  type ControlState,
  type HandoverEvent,
  type HandoverSnapshot,
  type SecretExit,
} from "./handover.js";

export {
  capabilityIdempotencyKey,
  checkPaymentCapability,
  consumePaymentCapability,
  isOpaqueMethodRef,
  issuePaymentCapability,
  type ApprovalChannel,
  type CapabilityCheck,
  type CapabilityRefusal,
  type CheckCapabilityInput,
  type IssueCapabilityInput,
  type IssueCapabilityOptions,
  type PaymentCapability,
} from "./capability.js";

export {
  classifyDrift,
  commitmentFromConfirmation,
  describePaymentSummary,
  judgeConfirmationReply,
  paymentSummaryDigest,
  planFromSummary,
  type ConfirmationJudgement,
  type DriftVerdict,
} from "./payment.js";

export {
  submitBooking,
  type BookingResult,
  type RefusalReason,
  type SubmitBookingOptions,
} from "./booking.js";
