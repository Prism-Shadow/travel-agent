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

export {
  CheckpointStore,
  type Checkpoint,
  type TaskStage,
} from "./checkpoint.js";

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
  buildEscalationCard,
  type CardActionValue,
  type CardPayload,
} from "./channel/card.js";

export {
  FeishuCardChannel,
  outcomeFromAction,
  type FeishuCardChannelOptions,
} from "./channel/feishu.js";
