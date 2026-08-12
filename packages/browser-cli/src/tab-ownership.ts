/**
 * Which session owns which tab.
 *
 * Sessions are isolated from each other in one respect and not at all in another: each has its
 * own `state`, but **tabs are a shared resource**. In extension mode every session drives the
 * same Chrome; in direct-CDP mode every session attaches to the same browser. So the idiom the
 * skill teaches —
 *
 * ```js
 * state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
 * ```
 *
 * — is a race the moment a second session runs it. Both find the same idle tab, both adopt it,
 * and then two agents type into one page. That is not a rare interleaving: it is the *expected*
 * outcome of running the documented pattern concurrently, which is exactly what comparing three
 * booking sites in parallel does.
 *
 * The fix is ownership, not locking in the mutual-exclusion sense: a claim is advisory, cheap,
 * and released with the session. What it buys is that `available()` never offers a page someone
 * else is working in, so the race stops being expressible.
 *
 * Tabs are keyed by CDP target id — the one identifier that means the same tab across two
 * Playwright connections. Playwright's own `Page` objects are per-connection and cannot be
 * compared between sessions.
 */

/** Outcome of a claim attempt. */
export type ClaimResult =
  | { ok: true; state: "claimed" | "already_yours" }
  | { ok: false; heldBy: string };

export class TabRegistry {
  private readonly owners = new Map<string, string>();

  /**
   * Claims a tab for a session. Idempotent for the current owner; never steals.
   *
   * Refusing to steal is deliberate: the alternative — last writer wins — would turn a visible
   * failure into a silent one, and the whole point is that a second agent finds out *before* it
   * types into someone else's checkout page.
   */
  claim(targetId: string, sessionId: string): ClaimResult {
    const owner = this.owners.get(targetId);
    if (owner === sessionId) return { ok: true, state: "already_yours" };
    if (owner !== undefined) return { ok: false, heldBy: owner };
    this.owners.set(targetId, sessionId);
    return { ok: true, state: "claimed" };
  }

  /** Releases a tab. Returns false when the session did not hold it (never steals a release). */
  release(targetId: string, sessionId: string): boolean {
    if (this.owners.get(targetId) !== sessionId) return false;
    this.owners.delete(targetId);
    return true;
  }

  /** Drops every claim a session holds. Called when its executor goes away. */
  releaseAll(sessionId: string): number {
    let released = 0;
    for (const [targetId, owner] of this.owners) {
      if (owner !== sessionId) continue;
      this.owners.delete(targetId);
      released += 1;
    }
    return released;
  }

  ownerOf(targetId: string): string | undefined {
    return this.owners.get(targetId);
  }

  /** True when the tab is free or already this session's — i.e. safe to work in. */
  isAvailableTo(targetId: string, sessionId: string): boolean {
    const owner = this.owners.get(targetId);
    return owner === undefined || owner === sessionId;
  }

  claimsOf(sessionId: string): string[] {
    return [...this.owners.entries()]
      .filter(([, owner]) => owner === sessionId)
      .map(([targetId]) => targetId);
  }

  /** Forgets a tab entirely — for a closed tab, whoever held it. */
  forget(targetId: string): void {
    this.owners.delete(targetId);
  }

  /** Every current claim, for `session list` and diagnostics. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.owners);
  }
}

/**
 * The registry every session in this process shares.
 *
 * A single instance is correct precisely because the relay is a single process: all executors
 * live inside it, so there is one authority and no synchronisation problem. A per-executor
 * registry would defeat the purpose — the sessions that need to see each other's claims are
 * exactly the ones that would each have their own.
 */
export const tabRegistry = new TabRegistry();
