/**
 * Pending user interactions for one Session: the thing an agent is waiting on.
 *
 * Shaped after `ApprovalRegistry`, and deliberately so — an interaction is the same kind of object
 * as a pending approval (a question published to whoever is watching, suspended until somebody
 * answers, resent on reconnect). What differs is who waits:
 *
 * - An approval's waiter is the model's own turn, inside this process. If the browser tab closes,
 *   the turn is still there.
 * - An interaction's waiter is the **agent's command**, at the other end of an HTTP request. That
 *   connection can drop — a proxy timeout, a restarted CLI — while the question is still perfectly
 *   valid, and the person may already be answering it.
 *
 * So a pending interaction is not tied to its waiter. `create` registers it, any number of callers
 * may `await` it, and a settled outcome is **remembered for a while** so a command that reconnects
 * after its socket died still learns what the person said instead of asking them again.
 *
 * Nothing here knows what a card looks like or how the answer travels back. It holds questions,
 * hands out answers, and guarantees that every question ends exactly once.
 */
import type { InteractionOutcome, UserInteraction } from "@travel-agent/transaction";

/** How many settled outcomes are kept for a reconnecting waiter. */
const REMEMBERED_OUTCOMES = 32;

interface PendingEntry {
  interaction: UserInteraction;
  /** Everyone currently waiting; a dropped connection simply stops being one of them. */
  waiters: Set<(outcome: InteractionOutcome) => void>;
  timer: NodeJS.Timeout | null;
}

export class InteractionRegistry {
  private readonly pending = new Map<string, PendingEntry>();
  /** Insertion-ordered, bounded: the last few answers, for a waiter that had to reconnect. */
  private readonly settled = new Map<string, InteractionOutcome>();

  get size(): number {
    return this.pending.size;
  }

  /** Everything still waiting for an answer, for replay to a subscriber that just connected. */
  list(): UserInteraction[] {
    return [...this.pending.values()].map((entry) => entry.interaction);
  }

  get(id: string): UserInteraction | undefined {
    return this.pending.get(id)?.interaction;
  }

  /**
   * Registers a question and starts its clock.
   *
   * The timeout resolves the interaction rather than rejecting it: a lapsed question is a state the
   * caller has to handle (usually by suspending the task and leaving the checkpoint), not an
   * exception to be caught alongside genuine faults. `onTimeout` rides along so the agent can tell
   * "nobody answered, keep the page" from "nobody answered, give up".
   */
  create(interaction: UserInteraction): void {
    if (this.pending.has(interaction.id)) {
      throw new Error(`Interaction ${interaction.id} is already pending.`);
    }
    const entry: PendingEntry = { interaction, waiters: new Set(), timer: null };
    this.pending.set(interaction.id, entry);
    if (interaction.timeoutMs > 0) {
      entry.timer = setTimeout(() => {
        this.settle(interaction.id, { status: "timeout", policy: interaction.onTimeout });
      }, interaction.timeoutMs);
      entry.timer.unref?.();
    }
  }

  /**
   * Waits for an answer.
   *
   * Resolves immediately when the question already settled and is still remembered — the
   * reconnect case. Throws only for a question this Session has never heard of, which is a caller
   * bug rather than a lapse.
   */
  await(id: string, signal?: AbortSignal): Promise<InteractionOutcome> {
    const settled = this.settled.get(id);
    if (settled) return Promise.resolve(settled);
    const entry = this.pending.get(id);
    if (!entry) return Promise.reject(new Error(`No such interaction: ${id}`));

    return new Promise<InteractionOutcome>((resolve) => {
      const waiter = (outcome: InteractionOutcome): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      // An aborted *wait* is not an aborted question: the command gave up listening, the card is
      // still on screen, and the person's answer still has to be recorded for whoever asks next.
      const onAbort = (): void => {
        entry.waiters.delete(waiter);
        resolve({ status: "aborted" });
      };
      entry.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Records the person's answer. False when the question is unknown or already settled. */
  resolve(id: string, outcome: InteractionOutcome): boolean {
    if (!this.pending.has(id)) return false;
    this.settle(id, outcome);
    return true;
  }

  /**
   * Ends every pending question the same way.
   *
   * Called when the turn ends or is interrupted. A card left on screen with nothing behind it is
   * worse than one that says the task moved on: the person would answer into a void.
   */
  settleAll(outcome: InteractionOutcome): void {
    for (const id of [...this.pending.keys()]) this.settle(id, outcome);
  }

  private settle(id: string, outcome: InteractionOutcome): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(id);
    this.remember(id, outcome);
    for (const waiter of entry.waiters) waiter(outcome);
    entry.waiters.clear();
  }

  private remember(id: string, outcome: InteractionOutcome): void {
    this.settled.delete(id);
    this.settled.set(id, outcome);
    while (this.settled.size > REMEMBERED_OUTCOMES) {
      const oldest = this.settled.keys().next().value;
      if (oldest === undefined) break;
      this.settled.delete(oldest);
    }
  }
}
