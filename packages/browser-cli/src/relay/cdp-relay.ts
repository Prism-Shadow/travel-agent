import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { createAdaptorServer } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import type { Protocol } from './cdp-types.js'
import type { CDPCommand, CDPResponseBase, CDPEventBase, CDPEventFor, RelayServerEvents } from './cdp-types.js'
import type {
  ExtensionMessage,
  ExtensionEventMessage,
  RecordingDataMessage,
  RecordingCancelledMessage,
  StartRecordingBody,
  StopRecordingParams,
  CancelRecordingParams,
  IsRecordingParams,
  StartStreamParams,
  StopStreamParams,
} from './protocol.js'
import pc from 'picocolors'
import util from 'node:util'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { VERSION, EXTENSION_IDS, IAB_BACKEND_ID, isLoopbackAddress, shouldAutoEnablePenguinBrowser } from '../shared/utils.js'
import { isIdentityValue } from './agent-identity.js'
import { tabRegistry } from './tab-ownership.js'
import { createCdpLogger, type CdpLogEntry, type CdpLogger } from './cdp-log.js'
import { RecordingRelay } from '../media/recording-relay.js'
import { StreamRelay } from '../media/stream-relay.js'
import { appendSessionToWsUrl } from '../browser/chrome-discovery.js'
import * as relayState from './relay-state.js'
import {
  ExtensionTransportDisconnectedError,
  extensionTransportDisconnectedMessage,
} from './extension-errors.js'
import {
  disconnectedSessionError,
  errorForBoundExtensionDisconnect,
  withSessionConnection,
} from './session-lifecycle.js'
import {
  assertStorageCookiesAreAuthorized,
  getAuthorizedCookieUrls,
  ROOT_STORAGE_COOKIE_METHODS,
  selectStorageCookieRoutingTarget,
} from './storage-cookie-routing.js'

/**
 * Constant-time string comparison for the `/iab` key.
 *
 * `===` on secrets leaks their prefix length through timing. The comparison is cheap and runs
 * once per connection, so there is no reason to take that risk.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) {
    // Compare against itself so the length check itself is not the fast path an attacker times.
    crypto.timingSafeEqual(left, left)
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

/**
 * Checks if a target should be filtered out (not exposed to Playwright).
 * Filters extension pages, service workers, and other restricted targets,
 * but allows our own extension pages for debugging purposes.
 */
function isRestrictedTarget(targetInfo: Protocol.Target.TargetInfo): boolean {
  const { url, type } = targetInfo

  // Filter by type - allow pages and iframe targets (OOPIFs)
  if (type !== 'page' && type !== 'iframe') {
    return true
  }

  // Filter by URL - block extension and chrome internal pages
  if (!url) {
    return false
  }

  // Allow our own extension pages
  if (url.startsWith('chrome-extension://')) {
    const extensionId = url.replace('chrome-extension://', '').split('/')[0]
    if (EXTENSION_IDS.includes(extensionId)) {
      return false
    }
    return true
  }

  // Block other restricted URLs
  const blockedPrefixes = ['chrome://', 'devtools://', 'edge://']
  return blockedPrefixes.some((prefix) => url.startsWith(prefix))
}

// CDP events dropped entirely (not forwarded to Playwright clients, not logged).
// Only events that no Playwright API depends on. See: https://private-project.invalid/repository/issues/96
// NOTE: *ExtraInfo events feed Playwright's ResponseExtraInfoTracker for request/response.allHeaders().
// webSocketFrame* events feed page.on('websocket') frame events. Both must be forwarded.
const DROPPED_CDP_EVENTS = new Set(['Network.dataReceived', 'Network.resourceChangedPriority'])

// Events filtered from human-readable logs and cdp.jsonl (superset of dropped events).
// These are still forwarded to Playwright but excluded from disk logs to reduce I/O.
const NOISY_LOG_EVENTS = new Set([
  ...DROPPED_CDP_EVENTS,
  'Network.requestWillBeSentExtraInfo',
  'Network.responseReceivedExtraInfo',
  'Network.requestServedFromCache',
  'Network.webSocketFrameSent',
  'Network.webSocketFrameReceived',
  'Network.webSocketFrameError',
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
])

export type RelayServer = {
  close(): void
  on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
  off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
}

export async function startPenguinBrowserCDPRelayServer({
  port = 19989,
  host = '127.0.0.1',
  token,
  iabKey,
  logger,
  cdpLogger,
}: {
  port?: number
  host?: string
  token?: string
  /**
   * Shared secret for the `/iab` transport. Handed to the desktop shell out of band (an env var
   * set when the relay is forked) so that knowing the port is not enough to drive the in-app
   * browser. Absent means the endpoint refuses every connection, which is the right default for a
   * standalone `penguin-browser serve`.
   */
  iabKey?: string
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
  cdpLogger?: CdpLogger
} = {}): Promise<RelayServer> {
  const emitter = new EventEmitter()
  const store = relayState.createRelayStore()
  /**
   * Remembered download behaviour, keyed by who set it.
   *
   * An extension keeps one behaviour for the browser, as a browser does. The in-app browser keys by
   * conversation *and* task, because it is one backend shared by every conversation and every turn.
   */
  const extensionDownloadBehavior = new Map<string, Protocol.Browser.SetDownloadBehaviorRequest>()
  const downloadBehaviorKey = (extensionId: string, sessionScope?: string, taskId?: string): string =>
    sessionScope ? `${extensionId}\u0000${sessionScope}\u0000${taskId ?? ''}` : extensionId

  const resolvedCdpLogger = cdpLogger || createCdpLogger()
  const logCdpJson = (entry: CdpLogEntry) => {
    resolvedCdpLogger.log(entry)
  }

  const getDefaultExtensionId = (): string | null => {
    return store.getState().extensions.keys().next().value || null
  }

  /**
   * Resolve an extension by ID, stableKey, or fallback.
   * Returns the unified ExtensionEntry which includes both state and I/O.
   */
  const getExtensionConnection = (
    extensionId?: string | null,
    options: { allowFallback?: boolean } = {},
  ): relayState.ExtensionEntry | null => {
    const currentRelayState = store.getState()
    const { extensions } = currentRelayState

    if (extensionId) {
      const direct = extensions.get(extensionId)
      if (direct?.ws) {
        return direct
      }
      // Try stableKey lookup.
      const byKey = relayState.findExtensionByStableKey(currentRelayState, extensionId)
      if (byKey) {
        const candidates = Array.from(extensions.values())
          .filter((ext) => ext.stableKey === byKey.stableKey)
          .reverse()
        for (const candidate of candidates) {
          if (candidate.ws) {
            return candidate
          }
        }
      }
      return null
    }

    if (!options.allowFallback) {
      return null
    }

    // From here on, the reserved in-app browser backend is invisible.
    //
    // It registers on the same table as Chrome extensions because it speaks the same protocol, but
    // it is not one, and nothing that *picks a browser on the user's behalf* may land on it. With
    // the desktop app running and no extension installed, this would otherwise find one connected
    // backend, choose it, and drive the in-app browser for a user who explicitly asked for their
    // own Chrome. An explicit lookup by id or stableKey above still finds it — that is how the IAB
    // path reaches its own backend.
    const candidates = publicExtensions()

    // Single extension — use it directly
    if (candidates.size === 1) {
      const only = [...candidates.values()][0]
      if (only?.ws) {
        return only
      }
    }

    // Multiple extensions — auto-select if exactly one has active targets.
    // This handles the common case of multiple Chrome profiles with the extension
    // installed, where only one profile has penguin-browser-enabled tabs. (#52)
    if (candidates.size > 1) {
      const activeExtensions = Array.from(candidates.values()).filter((ext) => {
        return ext.connectedTargets.size > 0
      })
      if (activeExtensions.length === 1 && activeExtensions[0].ws) {
        return activeExtensions[0]
      }
    }

    return null
  }

  /**
   * The connected Chrome extensions, excluding the reserved in-app browser backend.
   *
   * Everything a user or the CLI can *discover* goes through this: status endpoints, `/json/list`,
   * the single-backend fallback. "IAB only" has to look exactly like "no Chrome extension", or the
   * extension backend silently becomes the in-app browser again.
   */
  const publicExtensions = (): Map<string, relayState.ExtensionEntry> => {
    const filtered = new Map<string, relayState.ExtensionEntry>()
    for (const [id, entry] of store.getState().extensions) {
      if (entry.info.id === IAB_BACKEND_ID) continue
      filtered.set(id, entry)
    }
    return filtered
  }

  const getExtensionInfoFromRequest = (c: {
    req: { query: (name: string) => string | undefined }
  }): relayState.ExtensionInfo => {
    const browser = c.req.query('browser')
    const email = c.req.query('email')
    const id = c.req.query('id')
    const installId = c.req.query('installId')
    const version = c.req.query('v')
    return {
      browser: browser || undefined,
      email: email || undefined,
      id: id || undefined,
      installId: installId || undefined,
      version: version || undefined,
    }
  }

  const normalizeSessionId = (value: string | number | null | undefined): string | null => {
    if (value === undefined || value === null) {
      return null
    }
    const normalized = String(value)
    return normalized ? normalized : null
  }

  const getPageTargetForFrameId = ({
    extensionState,
    frameId,
  }: {
    extensionState: relayState.ExtensionEntry
    frameId: string
  }): relayState.ConnectedTarget | undefined => {
    return Array.from(extensionState.connectedTargets.values()).find((target) => {
      return target.targetInfo.type === 'page' && target.frameIds.has(frameId)
    })
  }

  const startExtensionPing = (extensionId: string): void => {
    const ext = store.getState().extensions.get(extensionId)
    if (!ext) {
      return
    }
    if (ext.pingInterval) {
      clearInterval(ext.pingInterval)
    }

    const pingInterval = setInterval(() => {
      const latestExt = store.getState().extensions.get(extensionId)
      latestExt?.ws?.send(JSON.stringify({ method: 'ping' }))
    }, 5000)

    store.setState((s) => relayState.updateExtensionIO(s, { extensionId, pingInterval }))
  }

  const stopExtensionPing = (extensionId: string): void => {
    const ext = store.getState().extensions.get(extensionId)
    if (!ext || !ext.pingInterval) {
      return
    }
    clearInterval(ext.pingInterval)
    store.setState((s) => relayState.updateExtensionIO(s, { extensionId, pingInterval: null }))
  }

  function logCdpMessage({
    direction,
    clientId,
    method,
    sessionId,
    params,
    id,
    source,
  }: {
    direction: 'to-playwright' | 'from-playwright' | 'from-extension'
    clientId?: string
    method: string
    sessionId?: string
    params?: any
    id?: number
    source?: 'extension' | 'server'
  }) {
    if (NOISY_LOG_EVENTS.has(method)) {
      return
    }

    const details: string[] = []

    if (id !== undefined) {
      details.push(`id=${id}`)
    }

    if (sessionId) {
      details.push(`sessionId=${sessionId}`)
    }

    if (params) {
      if (params.targetId) {
        details.push(`targetId=${params.targetId}`)
      }
      if (params.targetInfo?.targetId) {
        details.push(`targetId=${params.targetInfo.targetId}`)
      }
      if (params.sessionId && params.sessionId !== sessionId) {
        details.push(`sessionId=${params.sessionId}`)
      }
    }

    const detailsStr = details.length > 0 ? ` ${pc.gray(details.join(', '))}` : ''

    if (direction === 'from-playwright') {
      const clientLabel = clientId ? pc.blue(`[${clientId}]`) : ''
      logger?.log(pc.cyan('← Playwright'), clientLabel + ':', method + detailsStr)
    } else if (direction === 'from-extension') {
      logger?.log(pc.yellow('← Extension:'), method + detailsStr)
    } else if (direction === 'to-playwright') {
      const color = source === 'server' ? pc.magenta : pc.green
      const sourceLabel = source === 'server' ? pc.gray(' (server-generated)') : ''
      const clientLabel = clientId ? pc.blue(`[${clientId}]`) : pc.blue('[ALL]')
      logger?.log(color('→ Playwright'), clientLabel + ':', method + detailsStr + sourceLabel)
    }
  }

  function sendToPlaywright({
    message,
    clientId,
    source = 'extension',
    extensionId,
    scopeHint,
  }: {
    message: CDPResponseBase | CDPEventBase
    clientId?: string
    source?: 'extension' | 'server'
    extensionId?: string | null
    /**
     * The conversation a message belongs to when the message itself cannot say.
     *
     * Only the synthesised browser-wide download events need it: they carry neither a target nor a
     * session by design, and a scoped client would otherwise refuse them — leaving the client that
     * started the download as the one client that never hears about it.
     */
    scopeHint?: string
  }) {
    const messageToSend = source === 'server' && 'method' in message ? { ...message, __serverGenerated: true } : message

    logCdpJson({
      timestamp: new Date().toISOString(),
      direction: 'to-playwright',
      clientId,
      source,
      message: messageToSend,
    })

    if ('method' in message) {
      logCdpMessage({
        direction: 'to-playwright',
        clientId,
        method: message.method,
        sessionId: 'sessionId' in message ? message.sessionId : undefined,
        params: 'params' in message ? message.params : undefined,
        source,
      })
    }

    const messageStr = JSON.stringify(messageToSend)

    // Helper to safely send to a WebSocket, catching errors from closing connections.
    // When a Playwright client closes its WebSocket, there's a race window where:
    // 1. Playwright's _onClose runs (clears callbacks map)
    // 2. We might still have messages in flight or try to send
    // This can cause "Assertion error" in Playwright's crConnection.js if a response
    // arrives after callbacks were cleared. We wrap in try-catch to handle this gracefully.
    const safeSend = (client: relayState.PlaywrightClient) => {
      try {
        // Another conversation's page, in a shell that serves them all over one connection. The
        // ownership gate would refuse a *command* against it, but by then its URL, its title and
        // everything its page emitted have already been handed over.
        if (!clientMaySeeEvent(client, message, scopeHint)) return
        if ('method' in message && message.method === 'Target.attachedToTarget') {
          const params = message.params as Protocol.Target.AttachedToTargetEvent
          const targetId = params.targetInfo.targetId
          const sessionId = params.sessionId
          if (!clientMaySeeTarget(client, targetId)) return
          if (client.attachedTargets.has(targetId)) {
            logger?.log(
              pc.gray(`[Relay] Skipped duplicate Target.attachedToTarget for client ${client.id}: ${targetId}`),
            )
            return
          }
          client.attachedTargets.set(targetId, sessionId)
        } else if ('method' in message && message.method === 'Target.detachedFromTarget') {
          const params = message.params as Protocol.Target.DetachedFromTargetEvent
          if (!clientMaySeeTarget(client, params.targetId)) return
          if (params.targetId) {
            client.attachedTargets.delete(params.targetId)
          } else {
            for (const [targetId, sessionId] of client.attachedTargets) {
              if (sessionId === params.sessionId) {
                client.attachedTargets.delete(targetId)
                break
              }
            }
          }
        }
        client.ws.send(messageStr)
      } catch (e) {
        // WebSocket might be closing/closed - this is expected during disconnect
        logger?.log(pc.gray(`[Relay] Skipped sending to closing client ${client.id}: ${(e as Error).message}`))
      }
    }

    if (clientId) {
      const client = store.getState().playwrightClients.get(clientId)
      if (client) {
        safeSend(client)
      }
    } else {
      const { playwrightClients } = store.getState()
      for (const client of playwrightClients.values()) {
        if (extensionId && client.extensionId !== extensionId) {
          continue
        }
        safeSend(client)
      }
    }
  }

  type ForwardCdpParams = {
    method: string
    sessionId?: string
    params?: unknown
  }

  function getForwardCdpParams(value: unknown): ForwardCdpParams | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    const record = value as { method?: unknown; sessionId?: unknown; params?: unknown }
    if (typeof record.method !== 'string') {
      return undefined
    }
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
    return { method: record.method, sessionId, params: record.params }
  }

  async function sendToExtension({
    extensionId,
    method,
    params,
    timeout = 30000,
  }: {
    extensionId?: string | null
    method: string
    params?: unknown
    timeout?: number
  }): Promise<unknown> {
    const conn = getExtensionConnection(extensionId)
    if (!conn) {
      throw new ExtensionTransportDisconnectedError('Extension not connected')
    }
    const resolvedExtensionId = conn.id

    let id = 0
    store.setState((s) => {
      const ext = s.extensions.get(resolvedExtensionId)
      if (!ext) {
        return s
      }
      id = ext.messageId + 1
      const newExtensions = new Map(s.extensions)
      newExtensions.set(resolvedExtensionId, { ...ext, messageId: id })
      return { ...s, extensions: newExtensions }
    })

    if (!id) {
      throw new ExtensionTransportDisconnectedError('Extension not connected')
    }

    const message = { id, method, params }

    const forwardCdpParams = method === 'forwardCDPCommand' ? getForwardCdpParams(params) : undefined
    if (forwardCdpParams) {
      logCdpJson({
        timestamp: new Date().toISOString(),
        direction: 'to-extension',
        message: {
          method: forwardCdpParams.method,
          sessionId: forwardCdpParams.sessionId,
          params: forwardCdpParams.params,
        },
      })
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        store.setState((s) =>
          relayState.removeExtensionPendingRequest(s, {
            extensionId: resolvedExtensionId,
            requestId: id,
          }),
        )
        reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`))
      }, timeout)

      const pendingRequest = {
        resolve: (result) => {
          clearTimeout(timeoutId)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
      }

      store.setState((s) =>
        relayState.addExtensionPendingRequest(s, {
          extensionId: resolvedExtensionId,
          requestId: id,
          pendingRequest,
        }),
      )

      const latestExt = store.getState().extensions.get(resolvedExtensionId)
      if (!latestExt?.ws) {
        clearTimeout(timeoutId)
        store.setState((s) =>
          relayState.removeExtensionPendingRequest(s, {
            extensionId: resolvedExtensionId,
            requestId: id,
          }),
        )
        reject(new ExtensionTransportDisconnectedError('Extension not connected'))
        return
      }

      try {
        latestExt.ws.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timeoutId)
        store.setState((s) =>
          relayState.removeExtensionPendingRequest(s, {
            extensionId: resolvedExtensionId,
            requestId: id,
          }),
        )
        const sendError = error instanceof Error ? error : new Error(String(error))
        reject(new ExtensionTransportDisconnectedError(`Extension send failed: ${method}`, { cause: sendError }))
      }
    })
  }

  const recordingRelays = new Map<string, RecordingRelay>()

  // Find which extension connection owns a CDP tab session ID (pw-tab-*).
  // Used by recording routes where sessionId identifies the target tab.
  // Delegates to the pure derivation function from relay-state.ts.
  const findExtensionIdByCdpSession = (cdpSessionId: string): string | null => {
    return relayState.findExtensionIdByCdpSession(store.getState(), cdpSessionId)
  }

  // Resolve recording route session ID (CDP tab session) to extension connection.
  const resolveRecordingRoute = async ({
    sessionId,
  }: {
    sessionId: string | null
  }): Promise<{
    extensionId: string | null
    sessionId: string | null
  }> => {
    if (!sessionId) {
      return { extensionId: null, sessionId: null }
    }

    const extensionId = findExtensionIdByCdpSession(sessionId)
    return { extensionId, sessionId }
  }

  const getRecordingRelay = (extensionId?: string | null): RecordingRelay | null => {
    const allowDefault = !extensionId && publicExtensions().size === 1
    const conn = getExtensionConnection(extensionId, { allowFallback: allowDefault })
    if (!conn) {
      return null
    }
    const connId = conn.id
    if (!recordingRelays.has(connId)) {
      recordingRelays.set(
        connId,
        new RecordingRelay(
          (params) => sendToExtension({ extensionId: connId, ...params }),
          () => store.getState().extensions.has(connId),
          logger,
        ),
      )
    }
    return recordingRelays.get(connId) || null
  }

  // Stream relays pipe capture chunks to ffmpeg for live RTMP streaming
  // instead of accumulating them like RecordingRelay. Keyed per extension
  // connection exactly like recordingRelays.
  const streamRelays = new Map<string, StreamRelay>()

  const getStreamRelay = (extensionId?: string | null): StreamRelay | null => {
    const allowDefault = !extensionId && publicExtensions().size === 1
    const conn = getExtensionConnection(extensionId, { allowFallback: allowDefault })
    if (!conn) {
      return null
    }
    const connId = conn.id
    if (!streamRelays.has(connId)) {
      streamRelays.set(
        connId,
        new StreamRelay(
          (params) => sendToExtension({ extensionId: connId, ...params }),
          () => store.getState().extensions.has(connId),
          logger,
        ),
      )
    }
    return streamRelays.get(connId) || null
  }

  // Auto-create an initial blank tab when no targets exist. Set
  // PENGUIN_BROWSER_AUTO_ENABLE=false to require manually enabled tabs instead.
  async function maybeAutoCreateInitialTab(extensionId: string): Promise<void> {
    if (!shouldAutoEnablePenguinBrowser()) {
      return
    }
    const conn = getExtensionConnection(extensionId)
    if (!conn) {
      return
    }
    if (conn.connectedTargets.size > 0) {
      return
    }

    try {
      logger?.log(pc.blue('Auto-creating initial tab for Playwright client'))
      const result = (await sendToExtension({ extensionId, method: 'createInitialTab', timeout: 10000 })) as {
        success: boolean
        tabId: number
        sessionId: string
        targetInfo: Protocol.Target.TargetInfo
      }
      if (result.success && result.sessionId && result.targetInfo) {
        store.setState((s) =>
          relayState.addTarget(s, {
            extensionId,
            sessionId: result.sessionId,
            targetId: result.targetInfo.targetId,
            targetInfo: result.targetInfo,
          }),
        )
        const updatedTargets = store.getState().extensions.get(extensionId)?.connectedTargets.size || 0
        logger?.log(pc.blue(`Auto-created tab, now have ${updatedTargets} targets, url: ${result.targetInfo.url}`))
      }
    } catch (e) {
      logger?.error('Failed to auto-create initial tab:', e)
    }
  }

  function getPageTargetSessionIds({ extensionId }: { extensionId: string }): string[] {
    const extensionState = store.getState().extensions.get(extensionId)
    if (!extensionState) {
      return []
    }
    return Array.from(extensionState.connectedTargets.values())
      .filter((target) => {
        return target.targetInfo.type === 'page'
      })
      .map((target) => {
        return target.sessionId
      })
  }

  function maybeEmitBrowserDownloadCompatEvent({
    method,
    params,
    extensionId,
    scopeHint,
  }: {
    method: string
    params: unknown
    extensionId: string
    /**
     * Which conversation this download belongs to, for fan-out only.
     *
     * The compatibility event Playwright expects is browser-wide: no target, no session. Scoped
     * clients refuse browser-wide events precisely because they cannot be attributed — which would
     * mean nobody ever sees their own download. The scope travels beside the message instead of
     * inside it, so the payload stays exactly the one Playwright parses.
     */
    scopeHint?: string
  }): void {
    const browserEventMethod =
      method === 'Page.downloadWillBegin'
        ? 'Browser.downloadWillBegin'
        : method === 'Page.downloadProgress'
          ? 'Browser.downloadProgress'
          : null
    if (!browserEventMethod) {
      return
    }
    sendToPlaywright({
      message: {
        method: browserEventMethod,
        params,
      } as CDPEventBase,
      source: 'server',
      extensionId,
      ...(scopeHint ? { scopeHint } : {}),
    })
  }

  /**
   * A readable message from whatever the backend rejected with.
   *
   * A refusal comes back as the CDP error object the shell sent — `{ message }` — not as an
   * `Error`, so the obvious `String(error)` renders it as `[object Object]` and the reason the
   * caller needs is thrown away at the last step.
   */
  function describeRelayError(error: unknown): string {
    if (error instanceof Error) return error.message
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    return String(error)
  }

  async function applyDownloadBehaviorToTargets({
    extensionId,
    behavior,
    source,
    targetSessionIds,
    taskId,
  }: {
    extensionId: string
    behavior: Protocol.Browser.SetDownloadBehaviorRequest
    source?: CDPCommand['source']
    targetSessionIds?: string[]
    /**
     * The task on whose behalf this is applied.
     *
     * The in-app browser refuses a command that arrives without one, so a download path set up
     * on a client's behalf has to carry that client's task or it is rejected as foreign — and the
     * setting silently never takes effect.
     */
    taskId?: string
  }): Promise<{ failures: Array<{ sessionId: string; message: string }> }> {
    const pageBehavior: Protocol.Page.SetDownloadBehaviorRequest['behavior'] =
      behavior.behavior === 'allowAndName' ? 'allow' : behavior.behavior
    const pageParams: Protocol.Page.SetDownloadBehaviorRequest = (() => {
      if (pageBehavior === 'allow' && behavior.downloadPath) {
        return { behavior: pageBehavior, downloadPath: behavior.downloadPath }
      }
      return { behavior: pageBehavior }
    })()
    const sessions = targetSessionIds || getPageTargetSessionIds({ extensionId })
    const failures: Array<{ sessionId: string; message: string }> = []
    if (sessions.length === 0) {
      return { failures }
    }
    await Promise.all(
      sessions.map(async (targetSessionId) => {
        try {
          await sendToExtension({
            extensionId,
            method: 'forwardCDPCommand',
            params: {
              ...(taskId ? { taskId } : {}),
              sessionId: targetSessionId,
              method: 'Page.setDownloadBehavior',
              params: pageParams,
              source,
            },
          })
        } catch (error) {
          const message = describeRelayError(error)
          // chrome.debugger is attached to a page target, and current Chromium
          // rejects this deprecated Page-domain shim when it internally needs
          // browser-level access. Downloads still surface through Playwright and
          // can be saved with download.saveAs(); avoid reporting the expected
          // extension-mode limitation as a relay failure on every attachment.
          if (message.includes('Cannot not access browser-level commands')) {
            return
          }
          // Collected rather than only logged. A refused `setDownloadBehavior` means the caller's
          // downloads are going somewhere it did not choose — silently, and it has no other way to
          // find out. The caller decides what to do with that; see Browser.setDownloadBehavior.
          failures.push({ sessionId: targetSessionId, message })
          logger?.log(pc.yellow(`[Server] Failed to apply Page.setDownloadBehavior to ${targetSessionId}: ${message}`))
        }
      }),
    )
    return { failures }
  }

  /** The commands whose identity is rebuilt from the socket; see `withBoundIdentity`. */
  const IDENTITY_BOUND_METHODS = new Set(['iab-open-tab', 'iab-claim-tab'])

  async function routeCdpCommand({
    extensionId,
    method,
    params,
    sessionId,
    source,
    taskId,
    sessionScope,
    relayScope,
  }: {
    extensionId: string | null
    method: CDPCommand['method'] | (string & {})
    params: CDPCommand['params']
    sessionId?: CDPCommand['sessionId']
    source?: CDPCommand['source']
    /**
     * The task driving this connection, for in-app browser backends.
     *
     * Stamped onto the forwarded command so the shell can check it against the tab's owner. The
     * shell is the only place that check can happen: it is the one that knows a tab was retained
     * and handed back to the user, and a retained tab stays *alive* on purpose — there is no
     * destroyed view to fail against.
     */
    taskId?: string
    /**
     * The conversation this connection is in, for in-app browser backends.
     *
     * Decides which targets the command may see or act on. Filtering only the events would leave
     * every root operation — enumerating targets, reading cookies, setting a download path —
     * ranging over the whole shared backend, which is both a disclosure and a source of
     * nondeterministic ownership failures when another conversation's page happens to be first.
     */
    sessionScope?: string
    /**
     * Which relay session this connection *is*, for in-app browser backends.
     *
     * Bound at the socket, never taken from a payload: it is the concurrency claim a new or claimed
     * tab is recorded under, and a client able to name someone else's would take tabs out under
     * another session's identity.
     */
    relayScope?: string
  }) {
    const conn = getExtensionConnection(extensionId)
    const connectedTargets = conn?.connectedTargets || new Map<string, relayState.ConnectedTarget>()
    const resolvedExtensionId = conn?.id || extensionId

    /** The targets this client's conversation may act on (all of them for a non-IAB client). */
    const visibleTargets = (): relayState.ConnectedTarget[] =>
      targetsVisibleTo(connectedTargets.values(), sessionScope)

    /**
     * Forwards a command on behalf of this client, carrying its task.
     *
     * Every branch below goes through this rather than calling `sendToExtension` directly. The
     * in-app browser's ownership check is fail-closed, so a command that arrives without the task
     * that issued it is refused as foreign — and the branches that would have lost it are exactly
     * the ones Playwright uses to *start*: `Target.setAutoAttach`, `Runtime.enable`, closing a
     * page, reading cookies. Losing the identity there does not fail a feature, it fails the
     * connection.
     */
    const forwardForClient = async (forwarded: {
      method: string
      params?: unknown
      sessionId?: string
    }): Promise<unknown> => {
      return await sendToExtension({
        extensionId: resolvedExtensionId,
        method: 'forwardCDPCommand',
        params: { ...forwarded, source, ...(taskId ? { taskId } : {}) },
      })
    }

    /**
     * Every named target and CDP session on this command, checked in one place.
     *
     * Root operations name what they act on in their parameters rather than being *sent* to it, so
     * the shell's per-tab ownership gate never sees them: `Target.closeTarget`, `activateTarget`,
     * `detachFromTarget`, `exposeDevToolsProtocol` and `sendMessageToTarget` would each have
     * reached another conversation's page with nothing in the way. Special-casing them one at a
     * time is how the first four were missed, so this runs before the switch and covers whatever
     * the protocol grows next: if a command names a target or a session, it must be one this
     * conversation may see.
     *
     * Scope comes from the two scope maps rather than from the visible-target list because a
     * command may legitimately address a *child* session — an out-of-process iframe, a worker —
     * which is attributed by inheritance. Unknown attribution fails closed either way.
     */
    const assertNamesOnlyOwnScope = (): void => {
      if (!sessionScope) return
      const inScopeSession = (candidate: string): boolean =>
        iabSessionScopes.get(candidate) === sessionScope ||
        visibleTargets().some((target) => target.sessionId === candidate)
      if (sessionId !== undefined && !inScopeSession(sessionId)) {
        throw new Error(`No such target session in this conversation: ${sessionId}`)
      }
      const record =
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : undefined
      const namedTarget = record?.targetId
      if (typeof namedTarget === 'string' && iabScopes.get(namedTarget) !== sessionScope) {
        throw new Error(`No such target in this conversation: ${namedTarget}`)
      }
      const namedSession = record?.sessionId
      if (typeof namedSession === 'string' && !inScopeSession(namedSession)) {
        throw new Error(`No such target session in this conversation: ${namedSession}`)
      }
    }

    /**
     * Rebuilds the identity on the two shell commands from what this socket is bound to.
     *
     * `iab-open-tab` and `iab-claim-tab` are ours rather than CDP's, and they are the two commands
     * that *confer* authority: one creates a tab owned by a task, the other transfers an existing
     * one. Forwarding the caller's parameters meant the caller stated its own conversation, task
     * and relay session — so any client could name another client's live task and open tabs as it,
     * with the shell's "is that task running?" check passing because the *named* task genuinely
     * was. The shell cannot catch this: it is being told a true fact by the wrong party.
     *
     * So identity is never read from the payload. It comes from the URL the socket was opened with,
     * which the executor builds once from the environment its session was created with, and a
     * payload that names something different is refused rather than quietly overwritten — a
     * mismatch is either a bug or an attempt, and neither should proceed.
     */
    const withBoundIdentity = (raw: CDPCommand['params'], label: string): Record<string, unknown> => {
      if (!sessionScope || !taskId || !relayScope) {
        throw new Error(
          `${label} requires a connection bound to a conversation, a task and a relay session`,
        )
      }
      const record =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
      const bound: Record<string, string> = {
        sessionId: sessionScope,
        taskId,
        relaySessionId: relayScope,
      }
      for (const [key, value] of Object.entries(bound)) {
        const stated = record[key]
        if (stated !== undefined && stated !== value) {
          throw new Error(
            `${label} was sent with a ${key} this connection does not hold; the in-app browser ` +
              'refuses it. A session may only open and claim tabs for its own conversation and task.',
          )
        }
      }
      // A claim names an existing page, and that one *is* a target id: it must be one this
      // conversation can see. Checked here rather than by the generic validator because this is
      // the only parameter of these two commands that the generic rules apply to.
      const namedTarget = record.targetId
      if (label === 'iab-claim-tab') {
        if (typeof namedTarget !== 'string' || !namedTarget) {
          throw new Error('iab-claim-tab needs the target id of the tab to claim')
        }
        if (iabScopes.get(namedTarget) !== sessionScope) {
          throw new Error(`No such target in this conversation: ${namedTarget}`)
        }
      }
      return { ...record, ...bound }
    }

    // The two custom shell commands are **not** CDP and their parameters do not mean what the
    // generic validator assumes: their `sessionId` is a Travel Agent conversation, not a CDP
    // session, so checking it as one refuses every legitimate claim. They are validated entirely by
    // `withBoundIdentity`, which checks the thing that actually matters — that the caller is not
    // naming someone else's conversation, task or relay session.
    if (!IDENTITY_BOUND_METHODS.has(method)) assertNamesOnlyOwnScope()

    if (!sessionId && ROOT_STORAGE_COOKIE_METHODS.has(method)) {
      const browserContextIdValue =
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as { browserContextId?: unknown }).browserContextId
          : undefined
      if (browserContextIdValue !== undefined && typeof browserContextIdValue !== 'string') {
        throw new Error('browserContextId must be a string')
      }

      // Storage cookie commands are issued on Playwright's browser/root CDP
      // session, but chrome.debugger gives the extension page-scoped sessions.
      // Route through one already-authorized page in the same browser context.
      // connectedTargets belongs only to this client's bound extension, which
      // prevents a root command from crossing Chrome profiles/extensions.
      // Scoped: a root cookie command routed through the first page of the shared in-app browser
      // would nondeterministically pick another conversation's tab — which then fails the ownership
      // gate, or worse, succeeds against a page this client should not be touching.
      const target = selectStorageCookieRoutingTarget({
        connectedTargets: visibleTargets(),
        browserContextId: browserContextIdValue,
      })
      const authorizedUrls = getAuthorizedCookieUrls({
        connectedTargets: visibleTargets(),
        selectedTarget: target,
      })
      const sendPageCookieCommand = async (pageMethod: string, pageParams?: unknown): Promise<unknown> => {
        return await forwardForClient({
          sessionId: target.sessionId,
          method: pageMethod,
          params: pageParams,
        })
      }

      if (method === 'Storage.getCookies') {
        if (authorizedUrls.length === 0) return { cookies: [] }
        return await sendPageCookieCommand('Network.getCookies', { urls: authorizedUrls })
      }

      if (method === 'Storage.setCookies') {
        const cookies =
          params && typeof params === 'object' && !Array.isArray(params)
            ? (params as { cookies?: unknown }).cookies
            : undefined
        if (!Array.isArray(cookies)) {
          throw new Error('cookies must be an array for Storage.setCookies')
        }
        assertStorageCookiesAreAuthorized({ cookies, authorizedUrls })
        if (cookies.length === 0) return {}
        return await sendPageCookieCommand('Network.setCookies', { cookies })
      }

      // Storage.clearCookies is profile-wide when sent directly. Preserve the
      // per-tab authorization boundary by deleting only cookies visible to the
      // authorized page URLs in this browser context.
      if (authorizedUrls.length === 0) return {}
      const getCookiesResult = (await sendPageCookieCommand('Network.getCookies', {
        urls: authorizedUrls,
      })) as Protocol.Network.GetCookiesResponse
      await Promise.all(
        getCookiesResult.cookies.map(async (cookie) => {
          const deleteParams: Protocol.Network.DeleteCookiesRequest = {
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
          }
          await sendPageCookieCommand('Network.deleteCookies', deleteParams)
        }),
      )
      return {}
    }

    switch (method) {
      case 'Browser.getVersion': {
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          revision: '1.0.0',
          userAgent: 'CDP-Bridge-Server/1.0.0',
          jsVersion: 'V8',
        } satisfies Protocol.Browser.GetVersionResponse
      }

      case 'Browser.setDownloadBehavior': {
        const downloadBehaviorParams = params as Protocol.Browser.SetDownloadBehaviorRequest | undefined
        if (!downloadBehaviorParams?.behavior) {
          throw new Error('behavior is required for Browser.setDownloadBehavior')
        }
        if (resolvedExtensionId) {
          // Extension mode keeps one behaviour for the whole browser, which is what a browser has.
          // The in-app browser is shared by every conversation *and* by successive turns within
          // one, so the behaviour is remembered per **owner** — conversation and task — rather than
          // per browser. Keyed by conversation alone, a later turn's pages inherited an earlier
          // turn's download path, replayed under a task that no longer owned anything.
          const behaviorKey = downloadBehaviorKey(resolvedExtensionId, sessionScope, taskId)
          extensionDownloadBehavior.set(behaviorKey, downloadBehaviorParams)
          const { failures } = await applyDownloadBehaviorToTargets({
            extensionId: resolvedExtensionId,
            behavior: downloadBehaviorParams,
            source,
            // Only the pages this task actually owns, and stamped with its task so the shell's
            // ownership check sees who is asking. A released tab, or one belonging to another turn,
            // is not this caller's to redirect — and asking anyway produced a guaranteed refusal
            // for every such tab in the conversation.
            ...(sessionScope
              ? { targetSessionIds: ownedTargetSessionIds({ sessionScope, taskId }) }
              : {}),
            ...(taskId ? { taskId } : {}),
          })
          if (failures.length > 0) {
            // Returned to the caller instead of swallowed: downloads that quietly keep going to the
            // default directory look like a working `setDownloadBehavior` until a file goes
            // missing, and the executor can neither see nor retry what it was never told about.
            throw new Error(
              `Browser.setDownloadBehavior could not be applied to ${failures.length} page(s): ` +
                failures.map((failure) => `${failure.sessionId}: ${failure.message}`).join('; '),
            )
          }
        }
        return {}
      }

      // Target.setAutoAttach is a CDP command Playwright sends on first connection.
      // We use it as the hook to auto-create an initial tab. If Playwright changes
      // its initialization sequence in the future, this could be moved to a different command.
      case 'Target.setAutoAttach': {
        if (sessionId) {
          break
        }
        if (conn) {
          await maybeAutoCreateInitialTab(conn.id)
        }
        // Forward auto-attach so Chrome emits iframe Target.attachedToTarget events.
        // Playwright relies on these (with parentFrameId) when reconnecting over CDP.
        await forwardForClient({ method, params })
        return {}
      }

      case 'Target.setDiscoverTargets': {
        return {}
      }

      case 'Target.attachToTarget': {
        const attachParams = params as Protocol.Target.AttachToTargetRequest
        if (!attachParams?.targetId) {
          throw new Error('targetId is required for Target.attachToTarget')
        }

        for (const target of visibleTargets()) {
          if (target.targetId === attachParams.targetId) {
            return { sessionId: target.sessionId } satisfies Protocol.Target.AttachToTargetResponse
          }
        }

        throw new Error(`Target ${attachParams.targetId} not found in connected targets`)
      }

      case 'Target.getTargetInfo': {
        const infoReqParams = params as Protocol.Target.GetTargetInfoRequest | undefined
        const targetId = infoReqParams?.targetId

        if (targetId) {
          for (const target of visibleTargets()) {
            if (target.targetId === targetId) {
              return { targetInfo: target.targetInfo }
            }
          }
          // Asked about a specific target and it is not one of ours. Falling through to "the first
          // target this client can see" answers a question nobody asked with another page's URL and
          // title, and Playwright then treats that page as the one it addressed.
          throw new Error(`Target ${targetId} not found in connected targets`)
        }

        if (sessionId) {
          // Through the scoped set, not the raw map: a client bound to one conversation asking about
          // a CDP session belonging to another must be told nothing, and `connectedTargets.get`
          // would have answered with the page's URL and title.
          const target = visibleTargets().find((candidate) => candidate.sessionId === sessionId)
          if (target) {
            return { targetInfo: target.targetInfo }
          }
          // A named session this client may not see is refused rather than silently answered with
          // some other page's information.
          if (sessionScope) {
            throw new Error(`No such target session in this conversation: ${sessionId}`)
          }
        }

        const firstTarget = visibleTargets()[0]
        return { targetInfo: firstTarget?.targetInfo }
      }

      case 'Target.getTargets': {
        return {
          targetInfos: visibleTargets()
            .filter((t) => !isRestrictedTarget(t.targetInfo))
            .map((t) => ({
              ...t.targetInfo,
              attached: true,
            })),
        }
      }

      case 'Target.createTarget': {
        return await forwardForClient({ method, params })
      }

      case 'Target.closeTarget': {
        // A root command naming a target id, forwarded as-is, would let a client close another
        // conversation's page — the ownership gate never sees it, because closing a target is not a
        // command *to* that page. Refused unless the id is one this client may see at all.
        const closeParams = params as Protocol.Target.CloseTargetRequest | undefined
        const closeTargetId = closeParams?.targetId
        if (sessionScope && typeof closeTargetId === 'string') {
          const visible = visibleTargets().some((target) => target.targetId === closeTargetId)
          if (!visible) {
            throw new Error(`No such target in this conversation: ${closeTargetId}`)
          }
        }
        return await forwardForClient({ method, params })
      }

      /**
       * In-app browser tab creation.
       *
       * Phase 0 established that `Target.createTarget` answers "Not supported" on Electron, so a
       * page cannot be minted by the browser the way Chrome mints one. The desktop shell owns the
       * WebContentsView lifecycle instead, and this command asks it to build one. Routed through
       * the same tunnel as every other command so the executor needs no second channel — the same
       * shape the Ghost Browser bridge below already uses.
       */
      case 'iab-open-tab': {
        return await sendToExtension({
          extensionId: resolvedExtensionId,
          method: 'iab-open-tab',
          params: withBoundIdentity(params, 'iab-open-tab'),
        })
      }

      /**
       * In-app browser tab ownership.
       *
       * Like `iab-open-tab`, this is ours rather than CDP's, and it has to reach the shell as its
       * own method: forwarded as a CDP command it would be handed to Chromium, which has never
       * heard of it. Sent through the same tunnel so the executor needs no second channel.
       */
      case 'iab-claim-tab': {
        return await sendToExtension({
          extensionId: resolvedExtensionId,
          method: 'iab-claim-tab',
          params: withBoundIdentity(params, 'iab-claim-tab'),
        })
      }

      // Ghost Browser API - forward to extension for chrome.ghostPublicAPI/ghostProxies/projects
      case 'ghost-browser': {
        return await sendToExtension({
          extensionId: resolvedExtensionId,
          method: 'ghost-browser',
          params,
        })
      }

      case 'Runtime.enable': {
        if (!sessionId) {
          break
        }

        const contextCreatedPromise = new Promise<void>((resolve) => {
          const handler = ({ event }: { event: CDPEventBase }) => {
            if (event.method === 'Runtime.executionContextCreated' && event.sessionId === sessionId) {
              const params = event.params as Protocol.Runtime.ExecutionContextCreatedEvent | undefined
              if (params?.context?.auxData?.isDefault === true) {
                clearTimeout(timeout)
                emitter.off('cdp:event', handler)
                resolve()
              }
            }
          }
          const timeout = setTimeout(() => {
            emitter.off('cdp:event', handler)
            logger?.log(
              pc.yellow(
                `IMPORTANT: Runtime.enable timed out waiting for main frame executionContextCreated (sessionId: ${sessionId}). This may cause pages to not be visible immediately.`,
              ),
            )
            resolve()
          }, 3000)
          emitter.on('cdp:event', handler)
        })

        const result = await forwardForClient({ sessionId, method, params })

        await contextCreatedPromise

        return result
      }
    }

    return await forwardForClient({ sessionId, method, params })
  }

  const app = new Hono()

  // Global error handler — ensures server errors are logged, not silently swallowed
  app.onError((err, c) => {
    logger?.error('Unhandled route error:', err)
    return c.json({ error: err.message }, 500)
  })

  // CORS middleware for HTTP endpoints - only allows our specific extension IDs.
  // This prevents other extensions from reading responses via fetch/XHR.
  // WebSocket connections have their own separate origin validation.
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin.startsWith('chrome-extension://')) {
          return null
        }
        const extensionId = origin.replace('chrome-extension://', '')
        if (!EXTENSION_IDS.includes(extensionId)) {
          return null
        }
        return origin
      },
      allowMethods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
    }),
  )
  // Host header validation to prevent DNS rebinding attacks.
  // DNS rebinding is worse than a simple cross-origin request: the attacker
  // serves a page from http://evil.com:19989, then rebinds the DNS to
  // 127.0.0.1. The browser now considers requests to our relay as same-origin,
  // so Sec-Fetch-Site is "same-origin", CORS doesn't apply, and JSON POSTs
  // don't need preflight. This bypasses all our other defenses.
  // By rejecting any Host that isn't a known localhost value we kill DNS
  // rebinding at the root. When a valid token is provided (remote access), we
  // allow through regardless of Host since remote clients use real hostnames.
  const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

  // Parse the Host header into just the hostname, handling IPv6 brackets and
  // port suffixes. Returns null for missing or malformed values.
  function parseHostname(hostHeader: string | undefined): string | null {
    const value = hostHeader?.trim().toLowerCase()
    if (!value) {
      return null
    }
    // IPv6 in brackets: [::1] or [::1]:19989
    if (value.startsWith('[')) {
      const closingBracket = value.indexOf(']')
      if (closingBracket === -1) {
        return null
      }
      const host = value.slice(0, closingBracket + 1)
      const rest = value.slice(closingBracket + 1)
      if (rest && !/^:\d+$/.test(rest)) {
        return null
      }
      return host
    }
    // Bare ::1 without brackets (uncommon but possible)
    if (value === '::1') {
      return '::1'
    }
    // hostname or hostname:port
    const colonIndex = value.indexOf(':')
    if (colonIndex === -1) {
      return value
    }
    const host = value.slice(0, colonIndex)
    const portPart = value.slice(colonIndex + 1)
    if (!/^\d+$/.test(portPart)) {
      return null
    }
    return host || null
  }

  function hasValidToken(c: { req: { header: (name: string) => string | undefined; url: string } }): boolean {
    if (!token) {
      return false
    }
    const authHeader = c.req.header('authorization') || ''
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    const queryToken = new URL(c.req.url, 'http://localhost').searchParams.get('token')
    return bearerToken === token || queryToken === token
  }

  app.use('*', async (c, next) => {
    const hostname = parseHostname(c.req.header('host'))
    if (hostname && ALLOWED_HOSTS.has(hostname)) {
      return next()
    }
    // Remote clients with a valid token are allowed regardless of Host
    if (hasValidToken(c)) {
      return next()
    }
    // Missing Host header from non-browser clients (curl without Host) is fine
    // in local mode since they're not browser-based DNS rebinding attacks
    if (!hostname && !token) {
      return next()
    }
    logger?.log(
      pc.red(`Rejecting request with unexpected Host header: ${c.req.header('host')} (DNS rebinding protection)`),
    )
    return c.text('Forbidden - Invalid Host header', 403)
  })

  // In token mode the relay may sit behind a local tunnel process, so the
  // socket peer being loopback does not make an HTTP request trusted. Protect
  // discovery and status endpoints as well as the privileged CLI routes. The
  // extension itself has no token configuration; its origin is allowlisted for
  // the two endpoints it needs to establish and maintain its local connection.
  app.use('*', async (c, next) => {
    if (!token || c.req.path === '/') {
      return next()
    }

    const origin = c.req.header('origin') || ''
    const extensionId = origin.startsWith('chrome-extension://') ? origin.slice('chrome-extension://'.length) : ''
    const isTrustedExtension = EXTENSION_IDS.includes(extensionId)
    const isExtensionBootstrapPath = c.req.path === '/extension' || c.req.path === '/extension/status'
    if (isTrustedExtension && isExtensionBootstrapPath) {
      return next()
    }

    if (hasValidToken(c)) {
      return next()
    }

    logger?.log(pc.red(`Rejecting ${c.req.path}: invalid or missing token`))
    return c.text('Unauthorized', 401)
  })

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  const getCdpWsUrl = (c: { req: { header: (name: string) => string | undefined } }) => {
    const hostHeader = c.req.header('host') || `${host}:${port}`
    return `ws://${hostHeader}/cdp`
  }

  app.get('/', (c) => {
    return c.text('OK')
  })

  app.get('/version', (c) => {
    return c.json({ version: VERSION })
  })

  app.get('/extension/status', (c) => {
    const requestedInfo = getExtensionInfoFromRequest(c)
    const requestedStableKey = relayState.hasPersistentExtensionIdentity(requestedInfo)
      ? relayState.buildStableExtensionKey(requestedInfo, 'status-check')
      : null
    const extension = requestedStableKey
      ? relayState.findExtensionByStableKey(store.getState(), requestedStableKey)
      : getExtensionConnection(null, { allowFallback: true })
    const connected = Boolean(extension?.ws)
    const activeTargets = extension?.connectedTargets.size || 0
    const info = extension?.info

    return c.json({
      connected,
      activeTargets,
      browser: info?.browser || null,
      profile: info ? { email: info.email || '', id: info.id || '' } : null,
      penguinBrowserVersion: info?.version || null,
    })
  })

  app.get('/extensions/status', (c) => {
    // Public discovery: the reserved in-app browser backend is not a Chrome extension and does not
    // appear here. With the desktop app running and no extension installed, this reports zero —
    // which is the truth a caller asking about Chrome extensions needs.
    const extensions = Array.from(publicExtensions().values()).map((ext) => {
      return {
        extensionId: ext.id,
        stableKey: ext.stableKey,
        browser: ext.info.browser || null,
        profile: ext.info ? { email: ext.info.email || '', id: ext.info.id || '' } : null,
        activeTargets: ext.connectedTargets.size,
        penguinBrowserVersion: ext.info?.version || null,
      }
    })
    return c.json({ extensions })
  })

  // CDP Discovery Endpoints - Standard Chrome DevTools Protocol HTTP API
  // Allows tools like Playwright to discover the WebSocket URL via http://host:port
  // Spec: https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc

  app
    .on(['GET', 'PUT'], '/json/version', (c) => {
      return c.json({
        Browser: `Penguin Browser/${VERSION}`,
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: getCdpWsUrl(c),
      })
    })
    .on(['GET', 'PUT'], '/json/version/', (c) => {
      return c.json({
        Browser: `Penguin Browser/${VERSION}`,
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: getCdpWsUrl(c),
      })
    })
    .on(['GET', 'PUT'], '/json/list', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })
    .on(['GET', 'PUT'], '/json/list/', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })
    .on(['GET', 'PUT'], '/json', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })
    .on(['GET', 'PUT'], '/json/', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })

  app.post('/mcp-log', async (c) => {
    try {
      const { level, args } = await c.req.json()
      const logFn = (logger as any)?.[level] || logger?.log
      const prefix = pc.red(`[MCP] [${level.toUpperCase()}]`)
      logFn?.(prefix, ...args)
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 400)
    }
  })

  // Validate Origin header for WebSocket connections to prevent cross-origin attacks.
  // Browsers always send Origin header for WebSocket connections, but Node.js clients don't.
  // We only allow our specific extension IDs to prevent malicious websites or extensions
  // from connecting to the local WebSocket server.
  app.get(
    '/cdp/:clientId?',
    (c, next) => {
      const origin = c.req.header('origin')

      // Validate Origin header if present (Node.js clients don't send it)
      if (origin) {
        if (origin.startsWith('chrome-extension://')) {
          const extensionId = origin.replace('chrome-extension://', '')
          if (!EXTENSION_IDS.includes(extensionId)) {
            logger?.log(pc.red(`Rejecting /cdp WebSocket from unknown extension: ${extensionId}`))
            return c.text('Forbidden', 403)
          }
        } else {
          logger?.log(pc.red(`Rejecting /cdp WebSocket from origin: ${origin}`))
          return c.text('Forbidden', 403)
        }
      }

      if (token) {
        const url = new URL(c.req.url, 'http://localhost')
        const providedToken = url.searchParams.get('token')
        if (providedToken !== token) {
          return c.text('Unauthorized', 401)
        }
      }
      return next()
    },
    upgradeWebSocket((c) => {
      const clientId = c.req.param('clientId') || 'default'
      const url = new URL(c.req.url, 'http://localhost')
      const requestedExtensionId = url.searchParams.get('extensionId')
      // Which task opened this Playwright connection (in-app browser only). Carried in the URL
      // because that is the one thing every command on this socket has in common — the executor
      // builds the URL once, from the identity its session was created with.
      const rawTaskId = url.searchParams.get('iabTask')
      const clientTaskId = isIdentityValue(rawTaskId) ? rawTaskId : undefined
      // And which conversation it is in, which decides what it may be *shown* rather than what it
      // may do. Validated the same way: it arrives on a URL and ends up gating disclosure.
      const rawSessionId = url.searchParams.get('iabSession')
      const clientSessionId = isIdentityValue(rawSessionId) ? rawSessionId : undefined
      // And which relay session it is. On the URL for the same reason as the other two: it is a
      // property of the connection, and the two commands that confer tab ownership must take it
      // from here rather than from a payload the client writes.
      const rawRelaySessionId = url.searchParams.get('iabRelaySession')
      const clientRelaySessionId = isIdentityValue(rawRelaySessionId) ? rawRelaySessionId : undefined
      // When extensionId is explicit, resolve directly. Otherwise use fallback which
      // handles single-extension and uniquely-active-extension cases (#52).
      const resolvedExtension = requestedExtensionId
        ? getExtensionConnection(requestedExtensionId)
        : getExtensionConnection(null, { allowFallback: true })
      const clientExtensionId = resolvedExtension?.id || null

      const getBoundExtensionIdForClient = (): string | null => {
        const client = store.getState().playwrightClients.get(clientId)
        return client?.extensionId || null
      }

      return {
        async onOpen(_event, ws) {
          if (store.getState().playwrightClients.has(clientId)) {
            logger?.log(pc.yellow(`Rejecting duplicate Playwright clientId: ${clientId}`))
            ws.close(4004, 'Duplicate Playwright clientId')
            return
          }

          // A client bound to the reserved in-app browser backend must say which conversation and
          // task it is. Without both, everything downstream treats it as unscoped: it would be
          // shown every conversation's targets, and its commands would carry no task for the
          // ownership gate to check. Refused at the door rather than silently degraded.
          if (
            resolvedExtension?.info.id === IAB_BACKEND_ID &&
            (!clientSessionId || !clientTaskId || !clientRelaySessionId)
          ) {
            const reason =
              'In-app browser clients must carry a valid iabSession, iabTask and iabRelaySession'
            logger?.log(pc.red(`Rejecting Playwright client ${clientId}: ${reason}`))
            ws.close(4003, reason)
            return
          }

          if (!clientExtensionId) {
            const reason = requestedExtensionId
              ? `Unknown extensionId: ${requestedExtensionId}`
              : 'Multiple extensions connected. Specify extensionId.'
            logger?.log(pc.yellow(`Rejecting Playwright client ${clientId}: ${reason}`))
            ws.close(4003, reason)
            return
          }

          // Add client first so it can receive Target.attachedToTarget events
          store.setState((s) => {
            return relayState.addPlaywrightClient(s, {
              id: clientId,
              extensionId: clientExtensionId,
              ws,
              ...(clientSessionId ? { iabSession: clientSessionId } : {}),
              ...(clientTaskId ? { iabTask: clientTaskId } : {}),
            })
          })
          const extensionConnection = getExtensionConnection(clientExtensionId)
          const targetCount = extensionConnection?.connectedTargets.size || 0
          logger?.log(
            pc.green(
              `Playwright client connected: ${clientId} (${store.getState().playwrightClients.size} total) (extension? ${!!extensionConnection}) (${targetCount} pages)`,
            ),
          )
        },

        async onMessage(event, ws) {
          let message: CDPCommand

          try {
            message = JSON.parse(event.data.toString())
          } catch {
            return
          }

          const { id, sessionId, method, params, source } = message

          logCdpJson({
            timestamp: new Date().toISOString(),
            direction: 'from-playwright',
            clientId,
            message,
          })

          logCdpMessage({
            direction: 'from-playwright',
            clientId,
            method,
            sessionId,
            id,
          })

          emitter.emit('cdp:command', { clientId, command: message })

          const boundExtensionId = getBoundExtensionIdForClient()
          const extensionConn = getExtensionConnection(boundExtensionId)
          if (!extensionConn) {
            sendToPlaywright({
              message: {
                id,
                sessionId,
                error: { message: extensionTransportDisconnectedMessage('Extension not connected') },
              },
              clientId,
            })
            return
          }

          try {
            const result = await routeCdpCommand({
              extensionId: extensionConn.id,
              method,
              params,
              sessionId,
              source,
              ...(clientTaskId ? { taskId: clientTaskId } : {}),
              ...(clientSessionId ? { sessionScope: clientSessionId } : {}),
              ...(clientRelaySessionId ? { relayScope: clientRelaySessionId } : {}),
            })

            if (method === 'Target.setAutoAttach' && !sessionId) {
              // Re-read state after async routeCdpCommand — targets may have changed
              const freshExt = store.getState().extensions.get(extensionConn.id)
              const freshTargets = freshExt?.connectedTargets || new Map()
              for (const target of freshTargets.values()) {
                // Skip restricted targets (extensions, chrome:// URLs, non-page types)
                if (isRestrictedTarget(target.targetInfo)) {
                  continue
                }
                const attachedPayload = {
                  method: 'Target.attachedToTarget',
                  params: {
                    sessionId: target.sessionId,
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true,
                    },
                    waitingForDebugger: false,
                  },
                } satisfies CDPEventFor<'Target.attachedToTarget'>
                if (!target.targetInfo.url) {
                  logger?.error(
                    pc.red('[Server] WARNING: Target.attachedToTarget sent with empty URL!'),
                    JSON.stringify(attachedPayload),
                  )
                }
                logger?.log(
                  pc.magenta('[Server] Target.attachedToTarget full payload:'),
                  JSON.stringify(attachedPayload),
                )
                sendToPlaywright({
                  message: attachedPayload,
                  clientId,
                  source: 'server',
                })
              }
            }

            if (
              method === 'Target.setDiscoverTargets' &&
              (params as Protocol.Target.SetDiscoverTargetsRequest)?.discover
            ) {
              const freshExt2 = store.getState().extensions.get(extensionConn.id)
              const freshTargets2 = freshExt2?.connectedTargets || new Map()
              for (const target of freshTargets2.values()) {
                // Skip restricted targets (extensions, chrome:// URLs, non-page types)
                if (isRestrictedTarget(target.targetInfo)) {
                  continue
                }
                const targetCreatedPayload = {
                  method: 'Target.targetCreated',
                  params: {
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true,
                    },
                  },
                } satisfies CDPEventFor<'Target.targetCreated'>
                if (!target.targetInfo.url) {
                  logger?.error(
                    pc.red('[Server] WARNING: Target.targetCreated sent with empty URL!'),
                    JSON.stringify(targetCreatedPayload),
                  )
                }
                logger?.log(
                  pc.magenta('[Server] Target.targetCreated full payload:'),
                  JSON.stringify(targetCreatedPayload),
                )
                sendToPlaywright({
                  message: targetCreatedPayload,
                  clientId,
                  source: 'server',
                })
              }
            }

            if (method === 'Target.attachToTarget') {
              const attachResponse = result as Protocol.Target.AttachToTargetResponse | undefined
              const attachRequestParams = params as Protocol.Target.AttachToTargetRequest | undefined
              if (attachResponse?.sessionId) {
                const freshExt3 = store.getState().extensions.get(extensionConn.id)
                const freshTargets3 = freshExt3?.connectedTargets || new Map()
                const target = Array.from(freshTargets3.values()).find((t) => {
                  return t.targetId === attachRequestParams?.targetId
                })
                if (target) {
                  const attachedPayload = {
                    method: 'Target.attachedToTarget',
                    params: {
                      sessionId: attachResponse.sessionId,
                      targetInfo: {
                        ...target.targetInfo,
                        attached: true,
                      },
                      waitingForDebugger: false,
                    },
                  } satisfies CDPEventFor<'Target.attachedToTarget'>
                  if (!target.targetInfo.url) {
                    logger?.error(
                      pc.red('[Server] WARNING: Target.attachedToTarget (from attachToTarget) sent with empty URL!'),
                      JSON.stringify(attachedPayload),
                    )
                  }
                  logger?.log(
                    pc.magenta('[Server] Target.attachedToTarget (from attachToTarget) payload:'),
                    JSON.stringify(attachedPayload),
                  )
                  sendToPlaywright({
                    message: attachedPayload,
                    clientId,
                    source: 'server',
                  })
                }
              }
            }

            const response: CDPResponseBase = { id, sessionId, result }
            sendToPlaywright({ message: response, clientId })
            emitter.emit('cdp:response', { clientId, response, command: message })
          } catch (e) {
            logger?.error('Error handling CDP command:', method, params, e)
            const errorResponse: CDPResponseBase = {
              id,
              sessionId,
              error: { message: (e as Error).message },
            }
            sendToPlaywright({ message: errorResponse, clientId })
            emitter.emit('cdp:response', { clientId, response: errorResponse, command: message })
          }
        },

        onClose() {
          store.setState((s) => relayState.removePlaywrightClient(s, { clientId }))
          logger?.log(
            pc.yellow(
              `Playwright client disconnected: ${clientId} (${store.getState().playwrightClients.size} remaining)`,
            ),
          )
        },

        onError(event) {
          logger?.error(`Playwright WebSocket error [${clientId}]:`, event)
        },
      }
    }),
  )

  // Both backend transports present the relay with the same shape: a set of independent
  // per-target debugger sessions speaking forwardCDPCommand / forwardCDPEvent. A Chrome
  // extension gets there through chrome.debugger; the desktop shell gets there through
  // Electron's webContents.debugger. Only the authentication differs, so only the
  // authentication is written twice — the socket implementation below is shared.
  const backendSocket = upgradeWebSocket((c) => {
      const incomingExtensionInfo = getExtensionInfoFromRequest(c)
      const connectionId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      // Which backend this socket is. The implementation is shared by `/extension` and `/iab`, and
      // exactly one piece of it is not: ownership reconciliation, which reads a field only the
      // in-app browser sends. A Chrome extension's announcements carry no owner, and treating that
      // absence as "nobody holds this page" would clear the extension's own concurrency claims on
      // every attach and every reconnect.
      const isIabBackend = incomingExtensionInfo.id === IAB_BACKEND_ID
      return {
        onOpen(_event, ws) {
          // A reconnecting in-app browser is about to restate the whole truth about its tabs, so
          // whatever we still believe about the *old* connection has to go first. A tab destroyed
          // while the socket was down is never re-announced and never detached, and its concurrency
          // claim would otherwise sit in the registry forever — held by a session, against a page
          // that no longer exists, blocking anyone who wanted that target id back.
          if (isIabBackend) forgetIabBackendState()
          const stableKey = relayState.buildStableExtensionKey(incomingExtensionInfo, connectionId)

          // Check for existing connection with same stableKey and close it
          const existingExt = relayState.findExtensionByStableKey(store.getState(), stableKey)
          if (existingExt && existingExt.id !== connectionId) {
            logger?.log(
              pc.yellow(`Replacing extension connection for ${stableKey} (${existingExt.id} -> ${connectionId})`),
            )
            if (existingExt.ws) {
              existingExt.ws.close(4001, 'Extension Replaced')
            }
          }

          // State transition: add extension with ws handle included.
          // Existing same-stableKey entry stays until old socket onClose.
          store.setState((s) => {
            return relayState.addExtension(s, { id: connectionId, info: incomingExtensionInfo, stableKey, ws })
          })

          startExtensionPing(connectionId)
          logger?.log(`Extension connected (${connectionId})`)
        },

        async onMessage(event, ws) {
          const ext = store.getState().extensions.get(connectionId)
          if (!ext) {
            ws.close(1000, 'Extension not registered')
            return
          }
          // Handle binary data (capture chunks). Streams and recordings share
          // the same WS messages; StreamRelay gets first pick and returns true
          // when the chunk belongs to an active stream (tabId sets are disjoint
          // because the extension refuses a second capture of the same tab).
          if (event.data instanceof ArrayBuffer || Buffer.isBuffer(event.data)) {
            const buffer = Buffer.isBuffer(event.data) ? event.data : Buffer.from(event.data)
            const streamRelay = streamRelays.get(connectionId)
            if (streamRelay?.handleBinaryData(buffer)) {
              return
            }
            const relay = getRecordingRelay(connectionId)
            if (relay) {
              relay.handleBinaryData(buffer)
            }
            return
          }

          let message: ExtensionMessage

          try {
            message = JSON.parse(event.data.toString())
          } catch {
            ws.close(1000, 'Invalid JSON')
            return
          }

          if (message.id !== undefined) {
            const pending = (() => {
              let pendingRequest: relayState.ExtensionPendingRequest | null = null

              store.setState((s) => {
                const extensionEntry = s.extensions.get(connectionId)
                if (!extensionEntry) {
                  return s
                }

                const nextPendingRequest = extensionEntry.pendingRequests.get(message.id)
                if (!nextPendingRequest) {
                  return s
                }

                pendingRequest = nextPendingRequest
                return relayState.removeExtensionPendingRequest(s, {
                  extensionId: connectionId,
                  requestId: message.id,
                })
              })

              return pendingRequest
            })() as relayState.ExtensionPendingRequest | null

            if (!pending) {
              logger?.log('Unexpected response with id:', message.id)
              return
            }

            if (message.error) {
              // A backend states its refusal as a string; a CDP-shaped `{ message }` is read too,
              // because `new Error({...})` renders as `[object Object]` and the reason the caller
              // needs — which task owns the page, why the tab was refused — is lost at the last hop.
              pending.reject(new Error(describeRelayError(message.error)))
            } else {
              pending.resolve(message.result)
            }
          } else if (message.method === 'pong') {
            // Keep-alive response, nothing to do
          } else if (message.method === 'log') {
            const { level, args } = message.params
            const logFn = (logger as Record<string, unknown>)?.[level] as ((...args: unknown[]) => void) | undefined
            const logFunc = logFn || logger?.log
            const prefix = pc.yellow(`[Extension] [${level.toUpperCase()}]`)
            logFunc?.(prefix, ...args)
          } else if (message.method === 'recordingData') {
            const streamRelay = streamRelays.get(connectionId)
            if (!streamRelay?.handleRecordingData(message as RecordingDataMessage)) {
              const relay = getRecordingRelay(connectionId)
              if (relay) {
                relay.handleRecordingData(message as RecordingDataMessage)
              }
            }
          } else if (message.method === 'recordingCancelled') {
            const streamRelay = streamRelays.get(connectionId)
            if (!streamRelay?.handleRecordingCancelled(message as RecordingCancelledMessage)) {
              const relay = getRecordingRelay(connectionId)
              if (relay) {
                relay.handleRecordingCancelled(message as RecordingCancelledMessage)
              }
            }
          } else if (
            isIabBackend &&
            (message as { method?: string }).method === 'iab-ownership-changed'
          ) {
            // A tab changed hands without a reconnect — a later task claimed one the user had been
            // left with. Applied immediately, because the alternative is a claim this relay cannot
            // find when that task ends, leaving the page unclaimable by anyone.
            const changed = (message as { params?: { targetId?: unknown } }).params
            if (typeof changed?.targetId === 'string') {
              applyIabOwnership(changed.targetId, changed)
            }
          } else if (isIabBackend && (message as { method?: string }).method === 'iab-task-ended') {
            // The desktop shell telling us a harness task is over.
            //
            // The two ownership layers have to move together. The shell has already dropped the
            // tab's `ownedByTask` — which stops any *write* — and this drops the matching
            // `tabRegistry` claim, which is the concurrency lock. Releasing the lock does not grant
            // anyone write access: a later task still has to claim the tab through the shell before
            // `mayDrive` will allow anything. Without this the tab would be permanently
            // unclaimable — refused by the pane because it is unowned, and refused by the registry
            // because a dead session still holds it.
            const endedTaskId = (message as { params?: { taskId?: unknown } }).params?.taskId
            if (typeof endedTaskId === 'string' && endedTaskId) {
              releaseIabClaimsForTask(endedTaskId)
            }
          } else if (isIabBackend && (message as { method?: string }).method === 'iab-tab-closed') {
            // A tab the user closed. Its target id will never be seen again, so the registry must
            // forget the claim rather than hold it against a page that no longer exists.
            const closedTargetId = (message as { params?: { targetId?: unknown } }).params?.targetId
            if (typeof closedTargetId === 'string' && closedTargetId) {
              // The owner goes; the *scope* stays. The detach event still has to reach the client
              // that could see this target, and that check reads the scope.
              iabOwners.delete(closedTargetId)
              tabRegistry.forget(closedTargetId)
            }
          } else {
            const extensionEvent = message as ExtensionEventMessage

            if (extensionEvent.method !== 'forwardCDPEvent') {
              return
            }

            const { method, params, sessionId } = extensionEvent.params

            // The in-app browser announces who holds each page alongside the target itself. The
            // shell is the authority on that — it knows which task owns a tab and which relay
            // session claimed it — and it restates the whole truth on every reconnect, so this is
            // where the two registries are brought back into agreement after a dropped message or
            // a socket that went away mid-task.
            if (isIabBackend && method === 'Target.attachedToTarget') {
              reconcileIabOwnership(
                params as { targetInfo?: { targetId?: unknown }; sessionId?: unknown } | undefined,
                (extensionEvent.params as { iabOwner?: unknown }).iabOwner,
                sessionId,
              )
            }

            // Drop high-frequency noise events before logging or forwarding.
            // Old extensions may still send these; the relay filters them here.
            if (DROPPED_CDP_EVENTS.has(method)) {
              return
            }

            if (!NOISY_LOG_EVENTS.has(method)) {
              logCdpJson({
                timestamp: new Date().toISOString(),
                direction: 'from-extension',
                message: { method, params, sessionId },
              })
            }

            logCdpMessage({
              direction: 'from-extension',
              method,
              sessionId,
              params,
            })

            const cdpEvent: CDPEventBase = { method, sessionId, params }
            emitter.emit('cdp:event', { event: cdpEvent, sessionId })

            maybeEmitBrowserDownloadCompatEvent({
              method,
              params,
              extensionId: connectionId,
              // The originating page's conversation, so the client that started the download is the
              // one that hears about it — and the only one.
              ...(sessionId && iabSessionScopes.has(sessionId)
                ? { scopeHint: iabSessionScopes.get(sessionId)! }
                : {}),
            })

            if (method === 'Target.attachedToTarget') {
              const targetParams = params as Protocol.Target.AttachedToTargetEvent
              const incomingSessionId = sessionId
              const iframeParentFrameId = targetParams.targetInfo.parentFrameId
              // Read current extension state for iframe parent lookup
              const currentExtState = store.getState().extensions.get(connectionId)
              const iframeOwnerSessionId =
                targetParams.targetInfo.type === 'iframe' && iframeParentFrameId && currentExtState
                  ? getPageTargetForFrameId({ extensionState: currentExtState, frameId: iframeParentFrameId })
                      ?.sessionId
                  : undefined

              // Filter out restricted targets (unsupported types, extension pages, chrome:// URLs, etc.)
              if (isRestrictedTarget(targetParams.targetInfo)) {
                if (targetParams.waitingForDebugger && targetParams.sessionId) {
                  void sendToExtension({
                    extensionId: connectionId,
                    method: 'forwardCDPCommand',
                    params: {
                      sessionId: targetParams.sessionId,
                      method: 'Runtime.runIfWaitingForDebugger',
                      params: {},
                      source: 'server',
                    },
                  }).catch((error) => {
                    const msg = error instanceof Error ? error.message : String(error)
                    logger?.log(pc.yellow('[Server] Failed to resume restricted target:'), msg)
                  })
                }
                logger?.log(
                  pc.gray(
                    `[Server] Ignoring restricted target: ${targetParams.targetInfo.type} (${targetParams.targetInfo.url})`,
                  ),
                )
                return
              }

              if (!targetParams.targetInfo.url) {
                logger?.error(
                  pc.red('[Extension] WARNING: Target.attachedToTarget received with empty URL!'),
                  JSON.stringify({ method, params: targetParams, sessionId }),
                )
              }
              logger?.log(
                pc.yellow('[Extension] Target.attachedToTarget full payload:'),
                JSON.stringify({ method, params: targetParams, sessionId }),
              )

              // Check if we already sent this target to clients (e.g., from Target.setAutoAttach response)
              const alreadyConnected = currentExtState?.connectedTargets.has(targetParams.sessionId) ?? false

              // State transition: add/update target
              store.setState((s) =>
                relayState.addTarget(s, {
                  extensionId: connectionId,
                  sessionId: targetParams.sessionId,
                  targetId: targetParams.targetInfo.targetId,
                  targetInfo: targetParams.targetInfo,
                }),
              )

              // A new page inherits the download behaviour of *its own conversation*, and of the
              // task that set it. The cache is keyed per conversation for the in-app browser (see
              // Browser.setDownloadBehavior); an extension keeps one behaviour for the browser, as
              // a browser does.
              const behaviorScope = iabScopes.get(targetParams.targetInfo.targetId)
              const behaviorOwner = iabOwners.get(targetParams.targetInfo.targetId)
              // A new page inherits the behaviour set by *its own owner*: the conversation it
              // belongs to and the task that holds it. An unowned page — one retained from a
              // finished turn — inherits nothing, because the turn whose download path it would
              // have taken is over and the page is the user's.
              const cachedDownloadBehavior =
                !behaviorScope || behaviorOwner
                  ? extensionDownloadBehavior.get(
                      downloadBehaviorKey(connectionId, behaviorScope, behaviorOwner?.taskId),
                    )
                  : undefined
              if (cachedDownloadBehavior && targetParams.targetInfo.type === 'page') {
                void applyDownloadBehaviorToTargets({
                  extensionId: connectionId,
                  behavior: cachedDownloadBehavior,
                  targetSessionIds: [targetParams.sessionId],
                  ...(behaviorOwner ? { taskId: behaviorOwner.taskId } : {}),
                })
              }

              // Only forward to Playwright if this is a new target to avoid duplicates
              if (!alreadyConnected) {
                sendToPlaywright({
                  message: {
                    // Iframe targets must be routed to the parent page sessionId so Playwright attaches them under the right page.
                    // - iframeOwnerSessionId: derived parent session via parentFrameId -> page sessionId (frameId tracking).
                    // - incomingSessionId: extension event sessionId for the parent tab.
                    // The frameId mapping is racy: Target.attachedToTarget can arrive before Page.frameAttached/Page.frameNavigated populate frameIds.
                    // When iframeOwnerSessionId is missing we must fall back to incomingSessionId, otherwise Playwright receives the attach on the root
                    // session, detaches it, and the iframe stays paused (waitingForDebugger) which can hang navigations.
                    sessionId: iframeOwnerSessionId ?? incomingSessionId,
                    method: 'Target.attachedToTarget',
                    params: targetParams,
                  } as CDPEventBase,
                  source: 'extension',
                  extensionId: connectionId,
                })
              }
            } else if (method === 'Target.detachedFromTarget') {
              const detachParams = params as Protocol.Target.DetachedFromTargetEvent
              store.setState((s) =>
                relayState.removeTarget(s, { extensionId: connectionId, sessionId: detachParams.sessionId }),
              )

              sendToPlaywright({
                message: {
                  method: 'Target.detachedFromTarget',
                  params: detachParams,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Target.targetCrashed') {
              const crashParams = params as Protocol.Target.TargetCrashedEvent
              store.setState((s) =>
                relayState.removeTargetByCrash(s, { extensionId: connectionId, targetId: crashParams.targetId }),
              )
              logger?.log(pc.red('[Server] Target crashed, removing:'), crashParams.targetId)

              sendToPlaywright({
                message: {
                  method: 'Target.targetCrashed',
                  params: crashParams,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Target.targetInfoChanged') {
              const infoParams = params as Protocol.Target.TargetInfoChangedEvent
              store.setState((s) =>
                relayState.updateTargetInfo(s, { extensionId: connectionId, targetInfo: infoParams.targetInfo }),
              )

              sendToPlaywright({
                message: {
                  method: 'Target.targetInfoChanged',
                  params: infoParams,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.frameAttached') {
              const frameParams = params as Protocol.Page.FrameAttachedEvent
              if (sessionId) {
                store.setState((s) =>
                  relayState.addFrameId(s, { extensionId: connectionId, sessionId, frameId: frameParams.frameId }),
                )
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.frameDetached') {
              const frameParams = params as Protocol.Page.FrameDetachedEvent
              store.setState((s) =>
                relayState.removeFrameId(s, { extensionId: connectionId, frameId: frameParams.frameId }),
              )

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.frameNavigated') {
              const frameParams = params as Protocol.Page.FrameNavigatedEvent
              if (sessionId) {
                store.setState((s) =>
                  relayState.addFrameId(s, { extensionId: connectionId, sessionId, frameId: frameParams.frame.id }),
                )
              }
              const navigatedTarget = sessionId
                ? store.getState().extensions.get(connectionId)?.connectedTargets.get(sessionId)
                : undefined
              if (!frameParams.frame.parentId && sessionId && navigatedTarget?.targetId === frameParams.frame.id) {
                store.setState((s) =>
                  relayState.updateTargetUrlForFrame(s, {
                    extensionId: connectionId,
                    sessionId,
                    frameId: frameParams.frame.id,
                    url: frameParams.frame.url,
                    title: frameParams.frame.name || undefined,
                  }),
                )
                logger?.log(pc.magenta('[Server] Updated target URL from Page.frameNavigated:'), frameParams.frame.url)
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.navigatedWithinDocument') {
              const navParams = params as Protocol.Page.NavigatedWithinDocumentEvent
              const navigatedTarget = sessionId
                ? store.getState().extensions.get(connectionId)?.connectedTargets.get(sessionId)
                : undefined
              if (sessionId && navigatedTarget?.targetId === navParams.frameId) {
                store.setState((s) =>
                  relayState.updateTargetUrlForFrame(s, {
                    extensionId: connectionId,
                    sessionId,
                    frameId: navParams.frameId,
                    url: navParams.url,
                  }),
                )
                logger?.log(pc.magenta('[Server] Updated target URL from Page.navigatedWithinDocument:'), navParams.url)
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else {
              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            }
          }
        },

        onClose(event) {
          logger?.log(`Extension disconnected: code=${event.code} reason=${event.reason || 'none'} (${connectionId})`)

          // Cancel recordings BEFORE removing extension state (cancelRecording checks isExtensionConnected)
          const recordingRelay = recordingRelays.get(connectionId)
          if (recordingRelay) {
            recordingRelay.cancelRecording({}).catch(() => {
              // Ignore errors during cleanup
            })
          }
          recordingRelays.delete(connectionId)

          // Kill any active ffmpeg streams for this extension connection
          const streamRelay = streamRelays.get(connectionId)
          if (streamRelay) {
            streamRelay.destroyAll('Extension disconnected')
          }
          streamRelays.delete(connectionId)

          // Reject all pending I/O requests (state cleanup happens in removeExtension below)
          const closingExt = store.getState().extensions.get(connectionId)
          if (closingExt) {
            stopExtensionPing(connectionId)
            for (const pending of closingExt.pendingRequests.values()) {
              pending.reject(new ExtensionTransportDisconnectedError('Extension connection closed'))
            }
          }

          const currentRelayState = store.getState()
          const closingExtension = currentRelayState.extensions.get(connectionId)
          const successorCandidates = closingExtension
            ? Array.from(currentRelayState.extensions.values())
                .reverse()
                .filter((ext) => {
                  return ext.id !== connectionId && ext.stableKey === closingExtension.stableKey && Boolean(ext.ws)
                })
            : []
          const successorExtension = closingExtension ? successorCandidates[0] : undefined

          if (successorExtension) {
            logger?.log(
              pc.yellow(
                `Rebinding clients from ${connectionId} to ${successorExtension.id} (stableKey: ${successorExtension.stableKey})`,
              ),
            )
            store.setState((s) => {
              return relayState.rebindClientsToExtension(s, {
                fromExtensionId: connectionId,
                toExtensionId: successorExtension.id,
              })
            })
          }

          if (successorExtension) {
            store.setState((s) => relayState.removeExtension(s, { extensionId: connectionId }))
            return
          }

          // Keep bound Playwright clients alive until the next event-loop turn. The
          // marked pending-request rejections above may cross multiple await layers
          // before they reach Playwright, so one queueMicrotask would still close too early.
          // Deliver them before the socket closes; otherwise a fast reconnect can turn the
          // interrupted operation into an untyped HTTP 200/500 failure.
          store.setState((s) =>
            relayState.removeExtension(s, {
              extensionId: connectionId,
              preservePlaywrightClients: true,
            }),
          )
          setImmediate(() => {
            const { playwrightClients } = store.getState()
            for (const client of playwrightClients.values()) {
              if (client.extensionId !== connectionId) continue
              try {
                client.ws.close(1011, extensionTransportDisconnectedMessage('Extension disconnected'))
              } catch (error) {
                logger?.log(pc.dim(`Playwright client ${client.id} was already closed: ${String(error)}`))
              } finally {
                store.setState((s) => relayState.removePlaywrightClient(s, { clientId: client.id }))
              }
            }
          })
        },

        onError(event) {
          logger?.error('Extension WebSocket error:', event)
        },
      }
  })

  const extensionSocketAuth = (c: Context, next: Next) => {
      // 1. Host Validation: The extension endpoint must ONLY be accessed from localhost.
      // This prevents attackers on the network from hijacking the browser session
      // even if the server is exposed via 0.0.0.0.
      const info = getConnInfo(c)
      const remoteAddress = info.remote.address
      const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::1'

      if (!isLocalhost) {
        logger?.log(pc.red(`Rejecting /extension WebSocket from remote IP: ${remoteAddress}`))
        return c.text('Forbidden - Extension must be local', 403)
      }

      // 2. Origin Validation: Prevent browser-based attacks (CSRF).
      // Browsers cannot spoof the Origin header, so this ensures the connection
      // is coming from our specific Chrome Extension, not a malicious website.
      const origin = c.req.header('origin')
      if (!origin || !origin.startsWith('chrome-extension://')) {
        logger?.log(
          pc.red(`Rejecting /extension WebSocket: origin must be chrome-extension://, got: ${origin || 'none'}`),
        )
        return c.text('Forbidden', 403)
      }

      const extensionId = origin.replace('chrome-extension://', '')
      if (!EXTENSION_IDS.includes(extensionId)) {
        logger?.log(pc.red(`Rejecting /extension WebSocket from unknown extension: ${extensionId}`))
        return c.text('Forbidden', 403)
      }

      return next()
  }

  /**
   * In-app browser transport (design/002 §4.2 candidate C).
   *
   * The desktop shell connects here and bridges to `webContents.debugger`, so the agent drives a
   * WebContentsView through exactly the machinery that already drives a Chrome tab. Deliberately
   * a separate endpoint from `/extension` rather than a relaxation of it: that one requires a
   * `chrome-extension://` origin, which a Node client cannot present, and loosening it would have
   * widened the surface every real extension connects through.
   *
   * Three checks, each closing a different door:
   *   - loopback only, so nothing off-box can reach it even when the relay binds 0.0.0.0;
   *   - a per-run key the shell receives out of band (env at fork time) and never writes down,
   *     so another local process cannot simply connect to a known port;
   *   - no `Origin` header at all. A Node client never sends one, and a page always does, so
   *     this rejects browser-driven CSRF outright instead of matching against an allowlist.
   */
  const iabSocketAuth = (c: Context, next: Next) => {
    const remoteAddress = getConnInfo(c).remote.address
    if (!isLoopbackAddress(remoteAddress)) {
      logger?.log(pc.red(`Rejecting /iab WebSocket from remote IP: ${remoteAddress}`))
      return c.text('Forbidden - the in-app browser transport is local only', 403)
    }

    const origin = c.req.header('origin')
    if (origin) {
      logger?.log(pc.red(`Rejecting /iab WebSocket carrying an Origin header: ${origin}`))
      return c.text('Forbidden', 403)
    }

    if (!iabKey) {
      logger?.log(pc.red('Rejecting /iab WebSocket: this relay was started without an IAB key'))
      return c.text('Forbidden - no in-app browser key configured', 403)
    }
    const providedKey = c.req.query('key') ?? ''
    if (!timingSafeEqualString(providedKey, iabKey)) {
      logger?.log(pc.red('Rejecting /iab WebSocket: invalid key'))
      return c.text('Unauthorized', 401)
    }

    return next()
  }

  app.get('/extension', extensionSocketAuth, backendSocket)
  app.get('/iab', iabSocketAuth, backendSocket)

  // ============================================================================
  // CLI Execute Endpoints - For stateful code execution via CLI
  // ============================================================================

  // Session counter for suggesting next session number
  let nextSessionNumber = 1

  /**
   * What the in-app browser last told us about who holds each of its pages.
   *
   * Keyed by CDP target id. Rebuilt from target announcements, which the shell repeats on every
   * reconnect, so this converges on the shell's truth rather than accumulating whichever
   * notifications happened to get through.
   */
  const iabOwners = new Map<string, { taskId: string; relaySessionId: string }>()

  /**
   * The CDP sessions of the pages a task owns in its own conversation.
   *
   * Ownership, not visibility: a conversation's strip also holds tabs released to the user and tabs
   * belonging to other turns, and neither is this caller's to reconfigure.
   */
  const ownedTargetSessionIds = ({
    sessionScope,
    taskId,
  }: {
    sessionScope: string
    taskId?: string
  }): string[] => {
    const owned: string[] = []
    for (const extension of store.getState().extensions.values()) {
      for (const target of extension.connectedTargets.values()) {
        if (iabScopes.get(target.targetId) !== sessionScope) continue
        const owner = iabOwners.get(target.targetId)
        if (!owner || !taskId || owner.taskId !== taskId) continue
        owned.push(target.sessionId)
      }
    }
    return owned
  }

  /**
   * Which conversation each in-app browser target belongs to.
   *
   * One desktop shell serves every conversation over a single backend connection, so without this
   * every Playwright client would be shown every conversation's targets — their URLs and titles
   * included, before an ownership check has any chance to refuse a command. Recorded for released
   * tabs too: a tab that outlived its task still belongs to the conversation it was opened in.
   */
  const iabScopes = new Map<string, string>()
  /** How many target scopes are remembered; see `rememberScope` for why they are never deleted. */
  const MAX_IAB_SCOPES = 2000
  /**
   * Conversation scope by CDP session — roots and their children alike.
   *
   * Two jobs. A child target (an out-of-process iframe, a worker) announces itself through the view
   * that owns it and carries no owner of its own, so it inherits from here. And every *ordinary*
   * event — `Page.frameNavigated`, `Network.responseReceived`, `Runtime.consoleAPICalled` — is
   * routed by session id and nothing else, so this is the only way to tell whose page it is
   * before deciding which client may see it.
   */
  const iabSessionScopes = new Map<string, string>()

  /**
   * Records a target's conversation.
   *
   * Entries are **not** removed when a tab closes. A detach or crash event has to be delivered to
   * the client that could see the target, and deleting the scope first would fail that check closed
   * — the client would never learn its page went away. Target ids are never reused, so a stale entry
   * is inert; the map is bounded instead.
   */
  const rememberScope = (targetId: string, scope: string): void => {
    iabScopes.delete(targetId)
    iabScopes.set(targetId, scope)
    while (iabScopes.size > MAX_IAB_SCOPES) {
      const oldest = iabScopes.keys().next().value
      if (oldest === undefined) break
      iabScopes.delete(oldest)
    }
  }

  /**
   * Whether a client may be shown a target at all.
   *
   * Extension and direct clients carry no conversation and are unaffected — they connect to a
   * browser that has no such concept. A client that *is* bound to a conversation fails **closed**
   * on a target whose scope is unknown: the in-app browser serves every conversation over one
   * connection, so "we have not been told whose this is" is not a reason to disclose a URL.
   */
  const clientMaySeeTarget = (
    client: { iabSession?: string },
    targetId: string | undefined,
  ): boolean => {
    if (!client.iabSession) return true
    if (!targetId) return true
    return iabScopes.get(targetId) === client.iabSession
  }

  /**
   * Whether a client may be shown one backend event.
   *
   * Filtering only the target events was not enough: a shared in-app browser backend forwards every
   * `Page.*`, `Network.*`, `Runtime.*` and `DOM.*` event from every conversation's tabs down every
   * client socket. Playwright ignores sessions it does not know, but the payloads are page data —
   * URLs, headers, console output — and they can confuse its session graph besides.
   *
   * Three ways to attribute an event, and a deliberate refusal when none of them works: a
   * browser-wide event that cannot be tied to a conversation is not broadcast to a scoped client,
   * because "we cannot tell whose this is" is not a reason to send it to everyone.
   */
  const clientMaySeeEvent = (
    client: { iabSession?: string },
    message: CDPResponseBase | CDPEventBase,
    scopeHint?: string,
  ): boolean => {
    if (!client.iabSession) return true
    if (!('method' in message)) return true
    if (scopeHint !== undefined) return scopeHint === client.iabSession

    const params = (message.params ?? {}) as {
      targetInfo?: { targetId?: unknown }
      targetId?: unknown
      sessionId?: unknown
    }
    const targetId =
      typeof params.targetInfo?.targetId === 'string'
        ? params.targetInfo.targetId
        : typeof params.targetId === 'string'
          ? params.targetId
          : undefined
    if (targetId !== undefined) return iabScopes.get(targetId) === client.iabSession

    const routed = (message as { sessionId?: unknown }).sessionId
    if (typeof routed === 'string') return iabSessionScopes.get(routed) === client.iabSession

    const inner = typeof params.sessionId === 'string' ? params.sessionId : undefined
    if (inner !== undefined) return iabSessionScopes.get(inner) === client.iabSession

    return false
  }

  /** The subset of a backend's targets a conversation may see. */
  const targetsVisibleTo = (
    targets: Iterable<relayState.ConnectedTarget>,
    sessionScope: string | undefined,
  ): relayState.ConnectedTarget[] => {
    const all = [...targets]
    if (!sessionScope) return all
    return all.filter((target) => iabScopes.get(target.targetId) === sessionScope)
  }

  /**
   * Brings the concurrency registry in line with what the shell says about one target.
   *
   * The claim is made for the *exact* relay session the shell names, not for one inferred from the
   * task: a task can create more than one browser session, and guessing between them would claim
   * the page under a session that never asked for it. A null owner means the tab outlived its task
   * and belongs to the user — the claim is dropped so a later task can take it, which is a
   * different thing from being allowed to write to it (the shell still refuses that until the tab
   * is claimed there too).
   *
   * Safe before the executor exists: the registry is keyed by session id, and the cold-start
   * bootstrap deliberately opens its first tab under the id the session is about to be created
   * with. That is what makes the very first target of a fresh session claimed rather than orphaned.
   */
  const applyIabOwnership = (targetId: string, owner: unknown): void => {
    if (!targetId) return
    const record =
      owner && typeof owner === 'object'
        ? (owner as { sessionScope?: unknown; taskId?: unknown; relaySessionId?: unknown })
        : null
    const sessionScope = typeof record?.sessionScope === 'string' ? record.sessionScope : null
    const taskId = typeof record?.taskId === 'string' ? record.taskId : null
    const relaySessionId = typeof record?.relaySessionId === 'string' ? record.relaySessionId : null

    // The conversation is recorded even for a tab nobody owns. A released tab still belongs to the
    // conversation it was opened in, and that is what keeps it out of another conversation's view.
    if (sessionScope) rememberScope(targetId, sessionScope)

    if (!taskId || !relaySessionId) {
      iabOwners.delete(targetId)
      tabRegistry.forget(targetId)
      return
    }
    iabOwners.set(targetId, { taskId, relaySessionId })
    if (tabRegistry.ownerOf(targetId) !== relaySessionId) {
      // The shell is the authority; a stale claim on this target is replaced rather than allowed to
      // block the one the shell reports.
      tabRegistry.forget(targetId)
      tabRegistry.claim(targetId, relaySessionId)
    }
  }

  const reconcileIabOwnership = (
    params: { targetInfo?: { targetId?: unknown }; sessionId?: unknown } | undefined,
    owner: unknown,
    routedSessionId: string | undefined,
  ): void => {
    const targetId = params?.targetInfo?.targetId
    if (typeof targetId !== 'string') return

    if (owner) {
      applyIabOwnership(targetId, owner)
      // The shell's own announcement names the root CDP session it minted for this view. Children
      // attach *through* that session and inherit its conversation.
      const rootSessionId = params?.sessionId
      const scope = iabScopes.get(targetId)
      if (typeof rootSessionId === 'string' && scope) iabSessionScopes.set(rootSessionId, scope)
      return
    }

    // No owner: an out-of-process iframe or a worker, announced by Chromium through the view that
    // owns it. It inherits that view's conversation rather than being treated as unowned — and
    // certainly rather than having its scope cleared, which would make a client fail closed on its
    // own page's iframes.
    const inherited = routedSessionId ? iabSessionScopes.get(routedSessionId) : undefined
    if (!inherited) return
    rememberScope(targetId, inherited)
    // The child's own session inherits too, so events routed through it are attributable.
    const childSessionId = params?.sessionId
    if (typeof childSessionId === 'string') iabSessionScopes.set(childSessionId, inherited)
  }

  /**
   * Drops the concurrency claims held by a finished task's in-app browser pages.
   *
   * Exact: each target is released from the session the shell said was holding it, so a task with
   * two browser sessions releases each one's pages and no others. A message lost while the socket
   * was down costs nothing — the reconnect's announcements say the same thing again.
   */
  /**
   * Drops everything remembered about the in-app browser's targets.
   *
   * Called at the reconnect boundary, before the re-announcements rebuild it, and when the backend
   * disconnects for good. Deliberately touches only the IAB side: the Chrome extension's claims and
   * targets are a separate world and survive their own reconnects on their own terms.
   */
  const forgetIabBackendState = (): void => {
    for (const [targetId, owner] of iabOwners) tabRegistry.release(targetId, owner.relaySessionId)
    iabOwners.clear()
    iabScopes.clear()
    iabSessionScopes.clear()
  }

  const releaseIabClaimsForTask = (taskId: string): void => {
    for (const [targetId, owner] of [...iabOwners]) {
      if (owner.taskId !== taskId) continue
      tabRegistry.release(targetId, owner.relaySessionId)
      iabOwners.delete(targetId)
    }
  }

  // Lazy-load ExecutorManager to avoid circular imports and only when needed
  let executorManager: import('../executor/executor.js').ExecutorManager | null = null

  const getExecutorManager = async () => {
    if (!executorManager) {
      const { ExecutorManager } = await import('../executor/executor.js')
      // Pass config instead of URL so executor can generate unique client IDs for each connection
      executorManager = new ExecutorManager({
        cdpConfig: { host: '127.0.0.1', port, token },
        logger: logger || { log: console.error, error: console.error },
      })
    }
    return executorManager
  }

  // ============================================================================
  // Security middleware for privileged HTTP routes (/cli/*, /recording/*, /mcp-log)
  //
  // CORS alone does NOT prevent cross-origin POST attacks. Browsers skip the
  // preflight for "simple" requests (POST + Content-Type: text/plain), so a
  // malicious website can fire-and-forget a POST to localhost:19989/cli/execute
  // and the code executes before CORS even enters the picture.
  //
  // Three layers of defense:
  // 1. Sec-Fetch-Site: browsers set this forbidden header on every request.
  //    If present and not "same-origin"/"none", it's a cross-origin browser
  //    request → reject. Node.js clients don't send it → unaffected.
  // 2. Content-Type must be application/json on POST. This forces a CORS
  //    preflight as a fallback, which our CORS policy already blocks.
  // 3. When token mode is enabled (remote access), require the token on EVERY
  //    request, including loopback. Tunnel agents (traforo, ngrok, cloudflared)
  //    forward public traffic from 127.0.0.1, so a loopback bypass would be
  //    a full auth bypass. In-process callers attach the token themselves
  //    via PENGUIN_BROWSER_TOKEN env (set by the `serve` command at startup).
  // ============================================================================
  const privilegedRouteMiddleware = async (
    c: Parameters<Parameters<typeof app.use>[1]>[0],
    next: () => Promise<void>,
  ) => {
    // Block cross-origin browser requests via Sec-Fetch-Site header.
    // Browsers always set this forbidden header; it cannot be spoofed.
    // Non-browser clients (Node.js, curl, MCP) don't send it.
    const secFetchSite = c.req.header('sec-fetch-site')
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      logger?.log(pc.red(`Rejecting ${c.req.path}: cross-origin browser request (Sec-Fetch-Site: ${secFetchSite})`))
      return c.text('Forbidden - Cross-origin requests not allowed', 403)
    }

    // Require application/json on POST to force CORS preflight as backup defense.
    // A text/plain POST is a "simple request" that skips preflight entirely.
    if (c.req.method === 'POST') {
      const contentType = c.req.header('content-type') || ''
      if (!contentType.includes('application/json')) {
        logger?.log(pc.red(`Rejecting ${c.req.path}: Content-Type must be application/json, got: ${contentType}`))
        return c.text('Content-Type must be application/json', 415)
      }
    }

    // When token mode is enabled (remote/serve mode), require authentication
    // on EVERY request, including loopback. Earlier versions bypassed the
    // check for 127.0.0.1/::1 to spare in-process callers, but that's unsafe:
    // when the relay is fronted by a tunnel agent (traforo, ngrok, cloudflared,
    // etc.) running as a local process, every public request reaches the relay
    // from 127.0.0.1 and would skip auth. In-process callers must instead
    // attach the token themselves — they read PENGUIN_BROWSER_TOKEN from env, which
    // the `serve` command sets at startup.
    if (token) {
      const authHeader = c.req.header('authorization') || ''
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const url = new URL(c.req.url, 'http://localhost')
      const queryToken = url.searchParams.get('token')
      if (bearerToken !== token && queryToken !== token) {
        logger?.log(pc.red(`Rejecting ${c.req.path}: invalid or missing token`))
        return c.text('Unauthorized', 401)
      }
    }

    return next()
  }

  app.use('/cli/*', privilegedRouteMiddleware)
  app.use('/recording/*', privilegedRouteMiddleware)
  app.use('/stream/*', privilegedRouteMiddleware)
  app.use('/mcp-log', privilegedRouteMiddleware)

  const DEFAULT_EXEC_TIMEOUT = Number(process.env.PENGUIN_BROWSER_EXEC_TIMEOUT) || 10000

  const connectedExtensionKeys = (): Set<string> => {
    return new Set(
      Array.from(store.getState().extensions.values())
        .filter((extension) => extension.ws !== null)
        .map((extension) => extension.stableKey),
    )
  }

  const disconnectedExtensionSession = (sessionId: string, executor: import('../executor/executor.js').PlaywrightExecutor) => {
    return disconnectedSessionError(executor.getSessionInfo({ id: sessionId }), connectedExtensionKeys())
  }

  /**
   * Refuses a call from a task that does not own this in-app browser session.
   *
   * Returns the error body, or null when the call is allowed. Non-IAB sessions have no owner and
   * are never refused: extension and direct sessions are shared machinery with no per-task tabs.
   */
  const iabOwnershipMismatch = (
    sessionId: string,
    executor: import('../executor/executor.js').PlaywrightExecutor,
    callerTaskId: string | undefined,
  ) => {
    const owner = executor.iabIdentity
    if (!owner || owner.taskId === callerTaskId) return null
    return {
      text:
        `Session ${sessionId} belongs to task ${owner.taskId}, and this call is not from that ` +
        'task. In-app browser sessions are not shared between tasks: their tabs are owned by the ' +
        "task that opened them, and a finished task's tabs belong to the user. Run " +
        "'penguin-browser session new --iab' to get a session and tabs of your own.",
      images: [],
      screenshots: [],
      isError: true,
    }
  }

  app.post('/cli/execute', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId: string | number
        code: string
        timeout?: number
        /** The caller's current task; checked against the session's owner for IAB sessions. */
        taskId?: string
      }
      const sessionId = normalizeSessionId(body.sessionId)
      const { code, timeout = DEFAULT_EXEC_TIMEOUT } = body

      if (!sessionId || !code) {
        return c.json({ error: 'sessionId and code are required' }, 400)
      }

      const manager = await getExecutorManager()
      const existingExecutor = manager.getSession(sessionId)
      if (!existingExecutor) {
        return c.json(
          {
            text: `Session ${sessionId} not found. Run 'penguin-browser session new' first.`,
            images: [],
            screenshots: [],
            isError: true,
          },
          404,
        )
      }
      const disconnected = disconnectedExtensionSession(sessionId, existingExecutor)
      if (disconnected) {
        return c.json(disconnected, 409)
      }
      // In-app browser sessions are owned by the task that created them.
      //
      // Relay session ids are small integers a caller passes as `-s 3`, and they outlive the turn
      // that created them: nothing stops the *next* task in the same conversation from reusing one
      // and driving tabs the previous task opened. The executor cannot tell — it was built with the
      // first task's identity and would keep stamping it onto every command. So the check belongs
      // here, where the caller's own current task is still visible, and a mismatch is refused
      // rather than silently honoured.
      const iabOwnershipError = iabOwnershipMismatch(sessionId, existingExecutor, body.taskId)
      if (iabOwnershipError) {
        return c.json(iabOwnershipError, 409)
      }
      // Touch cloud session activity tracking if this session is cloud-backed
      const cloudTracking = cloudSessionTracking.get(sessionId)
      if (cloudTracking) {
        cloudTracking.lastActivityAt = Date.now()
        cloudTracking.activeExecutions++
      }

      let result: Awaited<ReturnType<typeof existingExecutor.execute>>
      try {
        result = await existingExecutor.execute(code, timeout)
      } finally {
        if (cloudTracking) {
          cloudTracking.activeExecutions--
          cloudTracking.lastActivityAt = Date.now()
        }
      }

      // Use the cloudTracking snapshot captured before execute (not a fresh
      // map lookup) so long-running executes that outlive idle cleanup still
      // report isCloud correctly.
      return c.json({ ...result, isCloud: Boolean(cloudTracking) })
    } catch (error: any) {
      const disconnectError = errorForBoundExtensionDisconnect(error)
      if (disconnectError) {
        return c.json(disconnectError, 409)
      }
      logger?.error('Execute endpoint error:', error)
      return c.json({ text: `Server error: ${error.message}`, images: [], screenshots: [], isError: true }, 500)
    }
  })

  app.post('/cli/reset', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId: string | number
        /** The caller's current task; checked against the session's owner for IAB sessions. */
        taskId?: string
      }
      const sessionId = normalizeSessionId(body.sessionId)

      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const manager = await getExecutorManager()
      const existingExecutor = manager.getSession(sessionId)
      if (!existingExecutor) {
        return c.json({ error: `Session ${sessionId} not found. Run 'penguin-browser session new' first.` }, 404)
      }
      const disconnected = disconnectedExtensionSession(sessionId, existingExecutor)
      if (disconnected) {
        return c.json(disconnected, 409)
      }
      // Resetting rebuilds the browser connection underneath whoever is using it, so it is subject
      // to the same ownership rule as executing: a task may only reset its own session.
      const resetMismatch = iabOwnershipMismatch(sessionId, existingExecutor, body.taskId)
      if (resetMismatch) return c.json(resetMismatch, 409)
      const { page, context } = await existingExecutor.reset()

      return c.json({
        success: true,
        pageUrl: page.url(),
        pagesCount: context.pages().length,
      })
    } catch (error: any) {
      const disconnectError = errorForBoundExtensionDisconnect(error)
      if (disconnectError) {
        return c.json(disconnectError, 409)
      }
      logger?.error('Reset endpoint error:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  app.get('/cli/sessions', async (c) => {
    const manager = await getExecutorManager()
    const liveKeys = connectedExtensionKeys()
    return c.json({ sessions: manager.listSessions().map((session) => withSessionConnection(session, liveKeys)) })
  })

  app.get('/cli/session/suggest', (c) => {
    return c.json({ next: nextSessionNumber })
  })

  app.post('/cli/session/new', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      extensionId?: string | null
      cwd?: string
      /** Direct CDP WebSocket URL — bypasses extension, connects straight to Chrome */
      cdpEndpoint?: string
      /** Launch a headless Chrome via chromium.launch() — no extension or relay CDP routing */
      headless?: boolean
      /** Drive the desktop shell's in-app WebContentsView (design/002 §4.2) */
      iab?: boolean
      /**
       * Who the tabs this session opens belong to (--iab only).
       *
       * `sessionId` is the harness conversation whose tab strip shows them; `taskId` is the turn
       * allowed to write to them. Both are required in IAB mode and neither is defaulted — the
       * relay has no way to know either, and a tab attributed to something invented can never be
       * released by the thing that owns it (design/002 §6.4).
       */
      sessionId?: string
      taskId?: string
      /** Browser name from discovery (e.g. "Chrome", "Brave") */
      browser?: string
      /** Profile info from discovery */
      profiles?: Array<{ name: string; email: string }>
      /** Cloud session tracking metadata (set by CLI when connecting to a cloud browser) */
      cloud?: {
        cloudSessionId: string
        cloudBaseUrl: string
        cloudToken: string
        /** BU VM hard timeout (ISO string or epoch ms) */
        timeoutAt?: string | number
        /** Block images/video/fonts to save proxy bandwidth */
        blockProxyResources?: boolean
      }
    }
    const sessionId = String(nextSessionNumber++)
    const cwd = body.cwd

    // Headless mode: launch Chrome via chromium.launch(), no extension needed.
    // Force connection immediately so missing Chrome errors surface at creation time,
    // not on first execute call.
    if (body.headless) {
      const manager = await getExecutorManager()
      const executor = manager.getExecutor({
        sessionId,
        cwd,
        cdpConfig: { headless: true },
        sessionMetadata: {
          extensionId: null,
          browser: 'Chrome (Headless)',
          profile: null,
        },
      })
      try {
        await executor.reset()
      } catch (error) {
        manager.deleteExecutor(sessionId)
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
      }
      const metadata = executor.getSessionMetadata()
      return c.json({
        id: sessionId,
        mode: 'headless' as const,
        extensionId: metadata.extensionId,
        browser: metadata.browser,
        profile: metadata.profile,
      })
    }

    // Direct CDP mode: skip extension lookup, pass direct WebSocket URL to executor
    if (body.cdpEndpoint) {
      if (!body.cdpEndpoint.startsWith('ws://') && !body.cdpEndpoint.startsWith('wss://')) {
        return c.json({ error: `Invalid cdpEndpoint: must start with ws:// or wss:// (got: ${body.cdpEndpoint})` }, 400)
      }
      // Use first profile from discovery for session metadata (if available)
      const firstProfile = body.profiles?.[0]
      const cloudTimeoutAt = body.cloud?.timeoutAt
        ? typeof body.cloud.timeoutAt === 'string'
          ? new Date(body.cloud.timeoutAt).getTime()
          : body.cloud.timeoutAt
        : undefined
      const manager = await getExecutorManager()
      const executor = manager.getExecutor({
        sessionId,
        cwd,
        cdpConfig: { directCdpUrl: appendSessionToWsUrl(body.cdpEndpoint, sessionId) },
        sessionMetadata: {
          extensionId: null,
          browser: body.browser || null,
          profile: firstProfile ? { email: firstProfile.email, id: firstProfile.name } : null,
        },
        cloudSession: body.cloud
          ? { timeoutAt: cloudTimeoutAt, blockProxyResources: body.cloud.blockProxyResources }
          : undefined,
      })
      const metadata = executor.getSessionMetadata()

      // Register cloud session tracking if cloud metadata was provided
      if (body.cloud) {
        cloudSessionTracking.set(sessionId, {
          cloudSessionId: body.cloud.cloudSessionId,
          cloudBaseUrl: body.cloud.cloudBaseUrl,
          cloudToken: body.cloud.cloudToken,
          lastActivityAt: Date.now(),
          activeExecutions: 0,
          timeoutAt: cloudTimeoutAt,
        })
        persistCloudSessions()
      }

      return c.json({
        id: sessionId,
        mode: 'direct' as const,
        extensionId: metadata.extensionId,
        browser: metadata.browser,
        profile: metadata.profile,
      })
    }

    // In-app browser mode: same transport contract as an extension, different backend. The
    // desktop shell registers itself under a reserved id, so selecting it is a lookup rather
    // than a new code path — everything downstream (targets, ownership, execute) is shared.
    if (body.iab) {
      // Checked before the backend is even looked up: an unattributable session is refused rather
      // than created, so the failure names the missing contract instead of surfacing later as a
      // tab that belongs to nobody.
      if (!isIdentityValue(body.sessionId) || !isIdentityValue(body.taskId)) {
        return c.json(
          {
            error: {
              code: 'IAB_IDENTITY_REQUIRED',
              message:
                'An in-app browser session needs both a sessionId (the conversation) and a taskId ' +
                '(the turn) so its tabs can be shown in the right place and released by the right ' +
                'task.',
              recovery: [
                'Let the harness run the command: it sets PENGUIN_SESSION_ID and PENGUIN_TASK_ID in',
                'the environment of everything an agent starts.',
                'There is deliberately no command-line override — the agent runs this command, so a',
                'flag would let it name any owner it liked. A development harness sets those two',
                'environment variables itself.',
              ],
            },
          },
          400,
        )
      }
      const identity = { sessionId: body.sessionId, taskId: body.taskId }
      const iabConn = [...store.getState().extensions.values()].find(
        (candidate) => candidate.info.id === IAB_BACKEND_ID,
      )
      if (!iabConn) {
        return c.json(
          {
            error: {
              code: 'IAB_NOT_CONNECTED',
              message: 'The in-app browser is not connected to this relay.',
              recovery: [
                'Start the desktop app, which forks the relay with an IAB key and connects to /iab.',
                'If the app is running, check that the browser pane is enabled (flag iab.enabled).',
              ],
            },
          },
          404,
        )
      }
      // Bootstrap a view before the executor connects.
      //
      // Without this the session is circular on a fresh app: the executor asks the shell for a tab
      // by sending `iab-open-tab` through an existing page's CDP session, and on a cold start there
      // is no page to send it through. The agent could never be the one to create the first view.
      // Creating it here — at the one point that already holds the backend connection — breaks the
      // cycle with a single mechanism rather than a special case inside the executor, and it means
      // `session new --iab` always hands back a session with somewhere to work.
      let iabBootstrapTargetId: string
      try {
        const bootstrap = await sendToExtension({
          extensionId: iabConn.id,
          method: 'iab-open-tab',
          // The relay session id goes with it, even though the executor does not exist yet. The
          // registry is keyed by session id, not by an object, so the shell can announce this first
          // tab as held by the session that is about to be created — which is what stops a cold
          // start's very first page from arriving unclaimed.
          params: { ...identity, relaySessionId: sessionId },
        })
        const targetId =
          bootstrap && typeof bootstrap === 'object'
            ? (bootstrap as { targetId?: unknown }).targetId
            : undefined
        if (typeof targetId !== 'string' || !targetId.trim()) {
          throw new Error('the desktop app did not return the bootstrap target id')
        }
        iabBootstrapTargetId = targetId
      } catch (error) {
        return c.json(
          {
            error: {
              code: 'IAB_BOOTSTRAP_FAILED',
              message: `The in-app browser could not open its first view: ${
                error instanceof Error ? error.message : String(error)
              }`,
              recovery: ['Check the desktop app is running with the browser pane enabled.'],
            },
          },
          502,
        )
      }

      const manager = await getExecutorManager()
      const executor = manager.getExecutor({
        sessionId,
        cwd,
        cdpConfig: {
          iab: true,
          extensionId: iabConn.stableKey,
          iabIdentity: identity,
          iabBootstrapTargetId,
        },
        sessionMetadata: {
          extensionId: iabConn.stableKey,
          browser: iabConn.info.browser || 'Travel Agent (in-app browser)',
          profile: null,
        },
      })
      const metadata = executor.getSessionMetadata()
      return c.json({
        id: sessionId,
        mode: 'iab' as const,
        extensionId: metadata.extensionId,
        browser: metadata.browser,
        profile: metadata.profile,
      })
    }

    // Extension mode (existing behavior)
    const extensionId = body.extensionId || null
    const allowDefault = !extensionId && publicExtensions().size === 1
    const conn = getExtensionConnection(extensionId, { allowFallback: allowDefault })
    if (!conn) {
      const error = extensionId
        ? `Extension not connected: ${extensionId}`
        : 'Multiple extensions connected. Specify extensionId.'
      return c.json({ error }, 404)
    }
    if (!relayState.hasPersistentExtensionIdentity(conn.info)) {
      return c.json(
        {
          error: {
            code: 'EXTENSION_UPGRADE_REQUIRED',
            message:
              'This Penguin Browser extension does not provide an installation identity and cannot back a persistent session safely.',
            recovery: [
              'Rebuild the current extension and reload packages/browser-extension/dist.',
              'Authorize a tab, then create the session again.',
            ],
          },
        },
        409,
      )
    }
    const manager = await getExecutorManager()
    const executor = manager.getExecutor({
      sessionId,
      cwd,
      sessionMetadata: {
        extensionId: conn.stableKey,
        browser: conn.info.browser || null,
        profile: conn.info ? { email: conn.info.email || '', id: conn.info.id || '' } : null,
      },
    })
    const metadata = executor.getSessionMetadata()
    return c.json({
      id: sessionId,
      mode: 'extension' as const,
      extensionId: metadata.extensionId,
      browser: metadata.browser,
      profile: metadata.profile,
    })
  })

  app.get('/cli/session/:id', async (c) => {
    const sessionId = c.req.param('id')
    const manager = await getExecutorManager()
    const executor = manager.getSession(sessionId)
    if (!executor) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.json(withSessionConnection(executor.getSessionInfo({ id: sessionId }), connectedExtensionKeys()))
  })

  app.post('/cli/session/delete', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId: string | number
        /** The caller's current task; checked against the session's owner for IAB sessions. */
        taskId?: string
        /**
         * How the task ended, as far as its tabs are concerned (design/002 §6.4).
         *
         * The agent is the only party that knows whether it merely searched, left an order behind,
         * or failed — so closing the browser session is where it says so, and the shell applies the
         * retain/close rules from it. Absent means "unknown", which retains.
         */
        outcome?: string
      }
      const sessionId = normalizeSessionId(body.sessionId)

      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const manager = await getExecutorManager()
      const executor = manager.getSession(sessionId)

      // Deleting a session tears down the executor another task may still be using; the same
      // ownership rule as /cli/execute applies.
      if (executor) {
        const mismatch = iabOwnershipMismatch(sessionId, executor, body.taskId)
        if (mismatch) return c.json(mismatch, 409)
      }

      // The agent's own account of how the turn went, delivered *before* the executor goes, while
      // the backend connection is still live. It does not end the turn — only the harness does
      // that, and the shell's supervisor learns it from the server — so this records a claim the
      // end-of-task rules will consult, and an abort can still override it. Best-effort: a shell
      // that has gone away has already taken its tabs with it.
      const iabIdentity = executor?.iabIdentity
      if (iabIdentity) {
        const iabConn = [...store.getState().extensions.values()].find(
          (candidate) => candidate.info.id === IAB_BACKEND_ID,
        )
        if (iabConn) {
          await sendToExtension({
            extensionId: iabConn.id,
            method: 'iab-end-task',
            params: { taskId: iabIdentity.taskId, outcome: body.outcome ?? 'unknown' },
          }).catch(() => {})
        }
      }

      // Close headless context before deleting to prevent context/page leaks
      // on the shared headless browser. Only affects headless sessions.
      if (executor) {
        await executor.closeHeadlessContext()
      }

      const deleted = manager.deleteExecutor(sessionId)

      if (!deleted) {
        return c.json({ error: `Session ${sessionId} not found` }, 404)
      }

      // If this was a cloud-backed session, stop the VM only if no other
      // relay session is still using the same cloud VM (reference counting).
      const cloudTracking = cloudSessionTracking.get(sessionId)
      if (cloudTracking) {
        const shouldStopVm = !hasOtherCloudReferences(sessionId, cloudTracking.cloudSessionId)
        cloudSessionTracking.delete(sessionId)
        persistCloudSessions()
        if (shouldStopVm) {
          disconnectCloudVm(cloudTracking)
        }
      }

      return c.json({ success: true })
    } catch (error: any) {
      logger?.error('Delete session endpoint error:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  // ============================================================================
  // Recording Endpoints - For screen recording via chrome.tabCapture
  // ============================================================================

  app.post('/recording/start', async (c) => {
    const body = (await c.req.json()) as {
      outputPath?: string
      sessionId?: string | number
      frameRate?: number
      audio?: boolean
      videoBitsPerSecond?: number
      audioBitsPerSecond?: number
    }
    const sessionId = normalizeSessionId(body.sessionId)
    const { sessionId: _sessionId, ...recordingOptions } = body
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const recordingParams = (
      resolvedSessionId ? { ...recordingOptions, sessionId: resolvedSessionId } : recordingOptions
    ) as StartRecordingBody
    const result = await relay.startRecording(recordingParams)
    const status = result.success ? 200 : result.error?.includes('required') ? 400 : 500
    return c.json(result, status)
  })

  app.post('/recording/stop', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const stopParams: StopRecordingParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.stopRecording(stopParams)
    const status = result.success ? 200 : result.error?.includes('not found') ? 404 : 500
    return c.json(result, status)
  })

  app.get('/recording/status', async (c) => {
    const sessionId = normalizeSessionId(c.req.query('sessionId'))
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ isRecording: false, authoritative: false })
    }
    const isRecordingParams: IsRecordingParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.isRecording(isRecordingParams)
    return c.json(result)
  })

  app.post('/recording/cancel', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const cancelParams: CancelRecordingParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.cancelRecording(cancelParams)
    return c.json(result)
  })

  // ============================================================================
  // Streaming Endpoints - Live RTMP streaming of a tab via ffmpeg
  // ============================================================================

  app.post('/stream/start', async (c) => {
    const body = (await c.req.json()) as StartStreamParams & { sessionId?: string | number }
    const sessionId = normalizeSessionId(body.sessionId)
    const { sessionId: _sessionId, ...streamOptions } = body
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getStreamRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const streamParams: StartStreamParams = resolvedSessionId
      ? { ...streamOptions, sessionId: resolvedSessionId }
      : streamOptions
    const result = await relay.startStream(streamParams)
    const status = result.success ? 200 : result.error?.includes('required') ? 400 : 500
    return c.json(result, status)
  })

  app.post('/stream/stop', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getStreamRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const stopParams: StopStreamParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.stopStream(stopParams)
    const status = result.success ? 200 : result.error?.includes('No active stream') ? 404 : 500
    return c.json(result, status)
  })

  app.get('/stream/status', async (c) => {
    const sessionId = normalizeSessionId(c.req.query('sessionId'))
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getStreamRelay(extensionId)
    if (!relay) {
      return c.json({ streaming: false })
    }
    const result = relay.streamStatus(resolvedSessionId ? { sessionId: resolvedSessionId } : {})
    return c.json(result)
  })

  // ============================================================================
  // Cloud session idle tracking
  //
  // Tracks lastActivityAt for cloud-backed sessions (those created via
  // cdpEndpoint pointing to Browser Use VMs). A background interval checks
  // every 60s and disconnects sessions idle > 10 minutes by calling the
  // website's /api/cloud/disconnect endpoint.
  // ============================================================================

  interface CloudSessionTracking {
    cloudSessionId: string
    /** Website base URL for disconnect calls */
    cloudBaseUrl: string
    /** Bearer token for website API */
    cloudToken: string
    lastActivityAt: number
    /** Number of currently running execute calls — skip idle timeout while > 0 */
    activeExecutions: number
    /** BU VM hard timeout (epoch ms) — used to warn users before expiration */
    timeoutAt?: number
  }

  const cloudSessionTracking = new Map<string, CloudSessionTracking>()
  const CLOUD_IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

  /** Check if any OTHER relay session references the same cloud VM.
   *  Used to prevent stopping a VM that's still used by another relay session
   *  (e.g. user attached twice via `session new --browser cloud-1`). */
  function hasOtherCloudReferences(relaySessionId: string, cloudSessionId: string): boolean {
    for (const [otherId, tracking] of cloudSessionTracking) {
      if (otherId !== relaySessionId && tracking.cloudSessionId === cloudSessionId) {
        return true
      }
    }
    return false
  }

  /** Disconnect a cloud VM via the website API (best-effort, non-blocking). */
  function disconnectCloudVm(tracking: CloudSessionTracking): void {
    fetch(new URL('/api/cloud/disconnect', tracking.cloudBaseUrl).toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tracking.cloudToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cloudSessionId: tracking.cloudSessionId }),
    }).catch((err) => {
      logger?.error('[Cloud] Failed to disconnect cloud session:', err)
    })
  }

  // ── Cloud session crash recovery ──────────────────────────────────
  // Persist cloud session IDs to disk so orphaned VMs can be cleaned up
  // if the relay process crashes. On startup, read the file and disconnect
  // any leftover VMs (best-effort).

  const CLOUD_SESSIONS_FILE = path.join(os.homedir(), '.penguin-browser', 'cloud-sessions.json')

  interface PersistedCloudSession {
    cloudSessionId: string
    cloudBaseUrl: string
    cloudToken: string
  }

  function persistCloudSessions(): void {
    // Dedupe by cloudSessionId — multiple relay sessions can reference the same VM
    const seen = new Set<string>()
    const entries: PersistedCloudSession[] = []
    for (const t of cloudSessionTracking.values()) {
      if (seen.has(t.cloudSessionId)) continue
      seen.add(t.cloudSessionId)
      entries.push({
        cloudSessionId: t.cloudSessionId,
        cloudBaseUrl: t.cloudBaseUrl,
        cloudToken: t.cloudToken,
      })
    }
    try {
      const dir = path.dirname(CLOUD_SESSIONS_FILE)
      fs.mkdirSync(dir, { recursive: true })
      if (entries.length > 0) {
        // Atomic write: write to temp file then rename, so a crash mid-write
        // doesn't leave corrupt JSON that blocks future cleanup.
        const tmpFile = CLOUD_SESSIONS_FILE + '.tmp'
        fs.writeFileSync(tmpFile, JSON.stringify(entries), { encoding: 'utf-8', mode: 0o600 })
        fs.renameSync(tmpFile, CLOUD_SESSIONS_FILE)
      } else {
        // No active sessions — remove file to avoid stale data
        try {
          fs.unlinkSync(CLOUD_SESSIONS_FILE)
        } catch {
          /* already gone */
        }
      }
    } catch {
      // Best-effort: don't crash relay if disk write fails
    }
  }

  function cleanupOrphanedCloudSessions(): void {
    let raw: string
    try {
      raw = fs.readFileSync(CLOUD_SESSIONS_FILE, 'utf-8')
    } catch {
      return // No file — nothing to clean up
    }

    let entries: PersistedCloudSession[]
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      // Validate shape: each entry must have cloudSessionId and cloudBaseUrl
      entries = parsed.filter((e): e is PersistedCloudSession => {
        return (
          e &&
          typeof e.cloudSessionId === 'string' &&
          typeof e.cloudBaseUrl === 'string' &&
          typeof e.cloudToken === 'string'
        )
      })
    } catch {
      // Corrupt JSON (e.g. crash during non-atomic write) — just remove it
      try {
        fs.unlinkSync(CLOUD_SESSIONS_FILE)
      } catch {
        /* ignore */
      }
      return
    }
    if (!entries.length) {
      try {
        fs.unlinkSync(CLOUD_SESSIONS_FILE)
      } catch {
        /* ignore */
      }
      return
    }

    logger?.log(
      pc.yellow(`[Cloud] Found ${entries.length} orphaned cloud session(s) from previous relay. Cleaning up...`),
    )
    // Remove file after we've read it — disconnect calls are best-effort async.
    // If they fail, the BU VM will eventually hit its own timeout anyway.
    try {
      fs.unlinkSync(CLOUD_SESSIONS_FILE)
    } catch {
      /* ignore */
    }

    for (const entry of entries) {
      disconnectCloudVm({
        cloudSessionId: entry.cloudSessionId,
        cloudBaseUrl: entry.cloudBaseUrl,
        cloudToken: entry.cloudToken,
        lastActivityAt: 0,
        activeExecutions: 0,
      })
    }
  }

  const cloudIdleInterval = setInterval(async () => {
    const now = Date.now()
    // Collect idle sessions first, then process — avoid mutating map during iteration
    const idleSessions: Array<[string, CloudSessionTracking]> = []
    for (const [sessionId, tracking] of cloudSessionTracking) {
      // VM already past BU hard timeout — schedule for cleanup regardless of activity
      if (tracking.timeoutAt && tracking.timeoutAt <= now) {
        idleSessions.push([sessionId, tracking])
        continue
      }
      // Timeout warnings are handled by the executor on each execute() call
      // (deduped by minute bucket) — no need to enqueue from the relay interval.

      if (tracking.activeExecutions > 0) continue
      if (now - tracking.lastActivityAt > CLOUD_IDLE_TIMEOUT_MS) {
        idleSessions.push([sessionId, tracking])
      }
    }

    if (idleSessions.length > 0) {
      for (const [sessionId, tracking] of idleSessions) {
        logger?.log(pc.yellow(`[Cloud] Stopping idle relay session ${sessionId} (idle > 10 min)`))
        // Check if other relay sessions reference the same cloud VM.
        // Only stop the VM when this is the last relay session for it.
        const shouldStopVm = !hasOtherCloudReferences(sessionId, tracking.cloudSessionId)
        cloudSessionTracking.delete(sessionId)
        executorManager?.deleteExecutor(sessionId)
        if (shouldStopVm) {
          disconnectCloudVm(tracking)
        }
      }
      persistCloudSessions()
    }
  }, 60_000)

  // Use createAdaptorServer instead of serve() so we control the listen()
  // timing. This lets us inject WebSocket upgrade handlers before binding and
  // await the bind to surface EADDRINUSE as a catchable error (issue #75).
  const server = createAdaptorServer({ fetch: app.fetch, hostname: host })
  injectWebSocket(server)

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, host)
  })

  // Clean up orphaned cloud sessions from a previous relay crash.
  // Must run AFTER successful listen — if another relay is already running,
  // we'd fail with EADDRINUSE but only after killing its live VMs.
  cleanupOrphanedCloudSessions()

  const wsHost = `ws://${host}:${port}`
  const cdpEndpoint = `${wsHost}/cdp`
  const extensionEndpoint = `${wsHost}/extension`

  logger?.log('CDP relay server started')
  logger?.log('Host:', host)
  logger?.log('Port:', port)
  logger?.log('Extension endpoint:', extensionEndpoint)
  logger?.log('CDP endpoint:', cdpEndpoint)

  return {
    close() {
      const { extensions, playwrightClients } = store.getState()

      for (const client of playwrightClients.values()) {
        client.ws.close(1000, 'Server stopped')
      }

      for (const ext of extensions.values()) {
        if (ext.pingInterval) {
          clearInterval(ext.pingInterval)
        }
        ext.ws?.close(1000, 'Server stopped')
      }

      // Close shared headless browser if any headless sessions were created (fire-and-forget)
      void import('../executor/executor.js').then(({ PlaywrightExecutor }) => {
        return PlaywrightExecutor.closeSharedHeadlessBrowser()
      })

      // Reset store state
      store.setState({
        extensions: new Map(),
        playwrightClients: new Map(),
      })
      clearInterval(cloudIdleInterval)
      cloudSessionTracking.clear()
      persistCloudSessions() // Remove the file on graceful shutdown
      server.close()
      emitter.removeAllListeners()
    },
    on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]) {
      emitter.on(event, listener as (...args: unknown[]) => void)
    },
    off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]) {
      emitter.off(event, listener as (...args: unknown[]) => void)
    },
  }
}
