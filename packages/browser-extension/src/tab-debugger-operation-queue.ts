export type TabDebuggerOperationKind = 'attach' | 'detach'

type QueueEntry<AttachResult> = {
  tail: Promise<void>
  lastKind: TabDebuggerOperationKind
  attachPromise?: Promise<AttachResult>
  detachPromise?: Promise<void>
}

/**
 * Serializes debugger attach/detach operations independently for every tab.
 *
 * Consecutive operations of the same kind are coalesced. An intervening
 * operation always creates a new queue entry, so attach -> detach -> attach
 * cannot accidentally reuse the first attach promise.
 */
export class TabDebuggerOperationQueue<AttachResult> {
  private readonly entries = new Map<number, QueueEntry<AttachResult>>()

  attach(tabId: number, operation: () => Promise<AttachResult>): Promise<AttachResult> {
    const current = this.entries.get(tabId)
    if (current?.lastKind === 'attach' && current.attachPromise) {
      return current.attachPromise
    }

    const attachPromise = this.enqueue(tabId, operation)
    this.setEntry(tabId, {
      tail: attachPromise.then(
        () => undefined,
        () => undefined,
      ),
      lastKind: 'attach',
      attachPromise,
    })
    return attachPromise
  }

  detach(tabId: number, operation: () => Promise<void>): Promise<void> {
    const current = this.entries.get(tabId)
    if (current?.lastKind === 'detach' && current.detachPromise) {
      return current.detachPromise
    }

    const detachPromise = this.enqueue(tabId, operation)
    this.setEntry(tabId, {
      tail: detachPromise.then(
        () => undefined,
        () => undefined,
      ),
      lastKind: 'detach',
      detachPromise,
    })
    return detachPromise
  }

  private enqueue<Result>(tabId: number, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.entries.get(tabId)?.tail ?? Promise.resolve()
    return previous.then(operation)
  }

  private setEntry(tabId: number, entry: QueueEntry<AttachResult>): void {
    this.entries.set(tabId, entry)
    void entry.tail.then(() => {
      if (this.entries.get(tabId) === entry) {
        this.entries.delete(tabId)
      }
    })
  }
}
