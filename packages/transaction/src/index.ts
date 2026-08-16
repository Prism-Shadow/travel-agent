/**
 * Transactional semantics for agents that take irreversible actions.
 *
 * Four pieces, each answering one question that "run the loop until the model stops" cannot:
 *
 * | Module | Question |
 * | --- | --- |
 * | {@link Journal} | Did this already happen? (write-ahead log, replay recovery) |
 * | {@link Commitment} | Is this still what they agreed to? (drift against an approved plan) |
 * | {@link CheckpointStore} | Where did the task get to? (resume after a handoff or a crash) |
 * | {@link Escalation} | How do I reach someone who is not watching? (typed, with a lapse policy) |
 *
 * Nothing here knows about browsers, travel, or any particular messaging app — those live in the
 * domain and browser layers. Keeping this package free of them is what would let it move into
 * PenguinHarness itself: any agent that spends money needs exactly this and nothing narrower.
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
  classifyDrift,
  commitmentFromConfirmation,
  describePaymentSummary,
  judgeConfirmationReply,
  paymentSummaryDigest,
  planFromSummary,
  type ConfirmationJudgement,
  type DriftVerdict,
} from "./payment.js";

export { buildEscalationCard, type CardActionValue, type CardPayload } from "./channel/card.js";

export {
  FeishuCardChannel,
  outcomeFromAction,
  type FeishuCardChannelOptions,
} from "./channel/feishu.js";
