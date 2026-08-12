/**
 * Always-on ghost cursor controller (Node side).
 *
 * Wires page.onMouseAction → applyGhostCursorMouseAction for every page.
 * Chains with any pre-existing onMouseAction callback. Cursor-apply is
 * fire-and-forget via a per-page queue so it does not block action completion.
 */

import type { BrowserContext, Page } from '@xmorse/playwright-core'
import {
  applyGhostCursorMouseAction,
  disableGhostCursor,
  enableGhostCursor,
  type GhostCursorClientOptions,
} from './ghost-cursor.js'

interface GhostCursorLogger {
  error: (...args: unknown[]) => void
}

interface RecordingTargetOptions {
  page?: Page
  sessionId?: string
}

export class GhostCursorController {
  private readonly previousMouseActionByPage = new WeakMap<Page, Page['onMouseAction']>()
  private readonly cursorApplyQueueByPage = new WeakMap<Page, Promise<void>>()
  private readonly attachedPages = new WeakSet<Page>()
  private readonly logger: GhostCursorLogger

  constructor(options: { logger: GhostCursorLogger }) {
    this.logger = options.logger
  }

  resolveRecordingTargetPage(options: {
    context: BrowserContext
    defaultPage: Page
    target?: RecordingTargetOptions
  }): Page {
    const { context, defaultPage, target } = options

    if (target?.page) {
      return target.page
    }

    if (target?.sessionId) {
      const pageForSession = context.pages().find((candidatePage) => {
        return candidatePage.sessionId() === target.sessionId
      })

      if (pageForSession) {
        return pageForSession
      }
    }

    return defaultPage
  }

  /** Wire onMouseAction. Idempotent. */
  attachToPage(options: { page: Page }): void {
    const { page } = options

    if (this.attachedPages.has(page)) {
      return
    }
    this.attachedPages.add(page)

    if (!this.previousMouseActionByPage.has(page)) {
      this.previousMouseActionByPage.set(page, page.onMouseAction)
    }
    const previousMouseAction = this.previousMouseActionByPage.get(page)

    page.onMouseAction = async (event) => {
      // Ghost cursor must never crash the main Playwright action (click, move, etc).
      // Wrap the entire cursor logic in try/catch so errors stay cosmetic.
      try {
        const pendingCursorApply = this.cursorApplyQueueByPage.get(page) || Promise.resolve()
        const nextCursorApply = pendingCursorApply
          .then(async () => {
            await applyGhostCursorMouseAction({ page, event })
          })
          .catch((error) => {
            if (page.isClosed()) {
              return
            }
            this.logger.error('[penguin-browser] Failed to apply ghost cursor action', error)
          })
        this.cursorApplyQueueByPage.set(page, nextCursorApply)
      } catch (error) {
        this.logger.error('[penguin-browser] Ghost cursor onMouseAction error (non-fatal)', error)
      }

      if (!previousMouseAction) {
        return
      }
      await previousMouseAction(event)
    }
  }

  detachFromPage(options: { page: Page }): void {
    const { page } = options
    if (!this.attachedPages.has(page)) {
      return
    }
    this.attachedPages.delete(page)
    page.onMouseAction = this.previousMouseActionByPage.get(page) ?? null
    this.previousMouseActionByPage.delete(page)
    this.cursorApplyQueueByPage.delete(page)
  }

  async show(options: { page: Page; cursorOptions?: GhostCursorClientOptions }): Promise<void> {
    try {
      const { page, cursorOptions } = options
      await enableGhostCursor({ page, cursorOptions })
    } catch {
      // Non-fatal — page may be closing or navigating.
    }
  }

  async hide(options: { page: Page }): Promise<void> {
    try {
      const { page } = options
      await disableGhostCursor({ page })
    } catch {
      // Non-fatal — page may be closing or navigating.
    }
  }
}
