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
  | { ok: true; state: 'claimed' | 'already_yours' }
  | {
      ok: false
      /** The relay session holding it, or a description of who does when it is not one of ours. */
      heldBy: string
      /**
       * Why the claim was refused, when the reason is not simply "another session has it".
       *
       * Present for in-app browser tabs, where a second authority has a say: the desktop shell
       * decides whether the *task* may write to a tab at all, and it can refuse a tab that no
       * relay session holds — one that outlived its task and belongs to the user now.
       */
      reason?:
        | 'released'
        | 'owned-by-other-task'
        | 'other-conversation'
        | 'gone'
        | 'task-ended'
        | 'task-not-live'
    }

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

export type AcquiredTab<T> = {
  tab: T
  source: 'reused' | 'created'
}

/**
 * Acquires a tab only when this call creates the ownership claim. Treating an
 * idempotent same-owner claim as success would let two concurrent opens return
 * the same page, so callers must map `already_yours` to false.
 */
export async function acquireOwnedTab<T>(options: {
  findReusable: () => Promise<T | null>
  create: () => Promise<T>
  claim: (tab: T) => Promise<boolean>
  attempts?: number
}): Promise<AcquiredTab<T>> {
  const attempts = options.attempts ?? 3
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reusable = await options.findReusable()
    if (reusable && (await options.claim(reusable))) return { tab: reusable, source: 'reused' }

    const created = await options.create()
    if (await options.claim(created)) return { tab: created, source: 'created' }
  }
  throw new Error('Could not open a tab: another session won each tab claim. Retry the operation.')
}

export async function acquireAndNavigateOwnedTab<T>(options: {
  findReusable: () => Promise<T | null>
  create: () => Promise<T>
  claim: (tab: T) => Promise<boolean>
  release: (tab: T) => Promise<unknown>
  navigate?: (tab: T, source: AcquiredTab<T>['source']) => Promise<unknown>
  discardCreated?: (tab: T) => Promise<void>
  attempts?: number
}): Promise<T> {
  const acquired = await acquireOwnedTab(options)
  try {
    await options.navigate?.(acquired.tab, acquired.source)
    return acquired.tab
  } catch (error) {
    await options.release(acquired.tab).catch(() => undefined)
    if (acquired.source === 'created') {
      await options.discardCreated?.(acquired.tab)
    }
    throw error
  }
}

/** Serializes a small critical section without serializing whole execute calls. */
class AsyncTaskQueue {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  }
}

export class SerializedOwnedTabOpener<T> {
  private readonly queue = new AsyncTaskQueue()
  /** The exact placeholder created before an IAB executor can connect, consumed at most once. */
  private bootstrapTargetId: string | null

  constructor(bootstrapTargetId?: string | null) {
    this.bootstrapTargetId = bootstrapTargetId ?? null
  }

  open(options: Parameters<typeof acquireAndNavigateOwnedTab<T>>[0]): Promise<T> {
    return this.queue.run(() => acquireAndNavigateOwnedTab(options))
  }

  /**
   * Uses a session's exact bootstrap tab before falling back to ordinary tab creation.
   *
   * The identifier is removed while the queued operation is in flight so two concurrent opens
   * cannot both use the placeholder. If navigation fails it is restored: the next queued call can
   * revalidate the exact target and retry it when it is still blank, or discard the marker when the
   * failed navigation changed the page. A missing, closed, navigated or foreign bootstrap is
   * deliberately reported by `findBootstrap` as null; only the exact id supplied at session
   * creation is ever considered.
   */
  openBootstrapFirst(options: {
    findBootstrap: (targetId: string) => Promise<T | null>
    useBootstrap: (tab: T) => Promise<T>
    create: () => Promise<T>
  }): Promise<T> {
    return this.queue.run(async () => {
      const targetId = this.bootstrapTargetId
      this.bootstrapTargetId = null
      if (targetId !== null) {
        const bootstrap = await options.findBootstrap(targetId)
        if (bootstrap !== null) {
          try {
            return await options.useBootstrap(bootstrap)
          } catch (error) {
            this.bootstrapTargetId = targetId
            throw error
          }
        }
      }
      return options.create()
    })
  }
}

/** A live tab considered by `tabs.open()` when deciding whether to create another. */
export type BlankReuseCandidate = {
  targetId: string
  isBlank: boolean
  owner?: string
}

/**
 * Whether this is the one IAB placeholder created for this executor's session.
 *
 * Exact identity is important: accepting an arbitrary same-owner blank would let an old task,
 * popup or user-created page stand in for bootstrap state. Ownership is equally important because
 * target ids remain visible briefly across lifecycle changes and a tab must never be stolen.
 */
export function isReusableIabBootstrapTarget(
  candidate: BlankReuseCandidate,
  expectedTargetId: string,
  sessionId: string,
): boolean {
  return (
    candidate.targetId === expectedTargetId &&
    candidate.isBlank &&
    candidate.owner === sessionId
  )
}

/**
 * Prefer an unclaimed about:blank over `newPage()`.
 *
 * The extension auto-creates a blank tab when no authorized Playwright pages remain
 * (AUTO_ENABLE). The skill then teaches `tabs.open(url)`, which used to always create a second tab
 * and leave the empty one sitting in the penguin-browser group. Reusing the unclaimed blank is not
 * the old racy "adopt any idle tab" idiom: a claimed blank stays with its owner, and a tab that
 * already has a URL is never taken this way. IAB's already-claimed bootstrap uses the exact-match
 * predicate above instead.
 */
export function selectReusableBlankTargetId(
  candidates: readonly BlankReuseCandidate[],
): string | undefined {
  return candidates.find((candidate) => candidate.isBlank && candidate.owner === undefined)?.targetId
}

/**
 * The registry every session in this process shares.
 *
 * A single instance is correct precisely because the relay is a single process: all executors
 * live inside it, so there is one authority and no synchronisation problem. A per-executor
 * registry would defeat the purpose — the sessions that need to see each other's claims are
 * exactly the ones that would each have their own.
 */
export const tabRegistry = new TabRegistry()
