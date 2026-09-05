import { resolveExtensionEndpoint, extensionSocketUrl, extensionSocketProtocols, availableDesktops, readConnectionChoice, CONNECTION_CHOICE_KEY, type RelayEndpoint, type ConnectionChoice } from './desktop-connection'
declare const process: { env: { PENGUIN_BROWSER_PORT: string } }
// Injected by vite at build time from penguin-browser/package.json version.
// CLI/MCP compare this against their own version to warn when the extension is outdated.
declare const __PENGUIN_BROWSER_VERSION__: string
// Bundled automation builds should not burn a tab on the welcome page, especially
// in headless/VPS flows where the extension is installed only to attach to the relay.
declare const __PENGUIN_BROWSER_OPEN_WELCOME_PAGE__: boolean

import dedent from 'string-dedent'
const js = dedent
import { createStore } from 'zustand/vanilla'
import { resolvePersistentInstallId } from './install-identity.js'
import type { ExtensionState, ConnectionState, TabState, TabInfo } from './types'
import { initPenguinBrowserToolbar } from './toolbar/toolbar'
import type { CDPEvent, Protocol } from 'penguin-browser/src/relay/cdp-types'
import type {
  ExtensionCommandMessage,
  ExtensionResponseMessage,
} from 'penguin-browser/src/relay/protocol'
import {
  handleGhostBrowserCommand,
  type GhostBrowserCommandParams,
} from 'penguin-browser/src/browser/ghost-browser'
// Inlined at build time via vite ?raw. Source: penguin-browser/src/client/ghost-cursor-client.ts
import ghostCursorBundleCode from '../../browser-cli/dist/ghost-cursor-client.js?raw'
// Bippy: React fiber introspection library, used for "Copy React Source Path" context menu.
// Built by penguin-browser/scripts/build-client-bundles.ts, exposes globalThis.__bippy
import bippyBundleCode from '../../browser-cli/dist/bippy.js?raw'
import {
  getActiveRecordings,
  handleStartRecording,
  handleStopRecording,
  handleIsRecording,
  handleCancelRecording,
  cleanupRecordingForTab,
} from './recording'
import { TabDebuggerOperationQueue } from './tab-debugger-operation-queue'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PENGUIN_BROWSER_PORT) || 19989

// CDP commands that should return near-instantly on a healthy tab. If a tab is
// frozen/hibernated (e.g. Ghost Browser suspended tabs), chrome.debugger.sendCommand
// hangs forever. These commands get a 10s timeout so frozen tabs fail fast instead of
// blocking the entire Playwright connection setup for 30s per command.
// Note: Page.addScriptToEvaluateOnNewDocument is NOT included because user-provided
// scripts with runImmediately:true can legitimately take longer than 10s.
const FAST_CDP_COMMAND_TIMEOUT_MS = new Map<string, number>([
  ['Browser.getWindowForTarget', 10000],
  ['Page.enable', 10000],
  ['Page.getFrameTree', 10000],
  ['Page.setLifecycleEventsEnabled', 10000],
  ['Page.createIsolatedWorld', 10000],
  ['Page.setDownloadBehavior', 10000],
  ['Log.enable', 10000],
  ['Network.enable', 10000],
  ['Emulation.setFocusEmulationEnabled', 10000],
  ['Emulation.setEmulatedMedia', 10000],
  ['Runtime.runIfWaitingForDebugger', 10000],
  ['Target.setAutoAttach', 10000],
])

async function sendCommandWithTimeout(
  debuggee: chrome.debugger.DebuggerSession,
  method: string,
  params: object | undefined,
  timeout: number,
): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      chrome.debugger.sendCommand(debuggee, method, params),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`CDP command timed out after ${timeout}ms: ${method} (tab may be frozen/hibernated)`))
        }, timeout)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

type NavigatorWithUaData = Navigator & {
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>
    getHighEntropyValues?: (hints: string[]) => Promise<{
      fullVersionList?: Array<{ brand: string; version: string }>
    }>
  }
}

type ExtensionIdentity = {
  browser: string
  email: string
  id: string
  installId: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createInstallId(): string {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values)
    .map((value) => {
      return value.toString(36)
    })
    .join('')
}

function browserNameFromBrands(brands: Array<{ brand: string; version: string }>): string | null {
  const brandNames = brands.map((brand) => {
    return brand.brand.trim().toLowerCase()
  })

  if (brandNames.some((brand) => brand === 'brave')) return 'Brave'
  if (brandNames.some((brand) => brand === 'microsoft edge')) return 'Edge'
  if (brandNames.some((brand) => brand === 'opera')) return 'Opera'
  if (brandNames.some((brand) => brand === 'vivaldi')) return 'Vivaldi'
  if (brandNames.some((brand) => brand === 'google chrome canary')) return 'Chrome Canary'
  if (brandNames.some((brand) => brand === 'google chrome')) return 'Chrome'
  if (brandNames.some((brand) => brand === 'chromium')) return 'Chromium'
  return null
}

async function detectBrowserName(): Promise<string> {
  if ((chrome as unknown as { ghostPublicAPI?: unknown }).ghostPublicAPI) {
    return 'Ghost'
  }

  const navigatorWithUaData = navigator as NavigatorWithUaData
  const brands = navigatorWithUaData.userAgentData?.brands
  const highEntropyValues = await navigatorWithUaData.userAgentData
    ?.getHighEntropyValues?.(['fullVersionList'])
    .catch(() => {
      return null
    })
  const fullVersionList = highEntropyValues?.fullVersionList || []

  const highEntropyName = browserNameFromBrands(fullVersionList)
  if (highEntropyName) {
    return highEntropyName
  }

  if (brands && brands.length > 0) {
    const lowEntropyName = browserNameFromBrands(brands)
    if (lowEntropyName) {
      return lowEntropyName
    }
  }

  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('edg/')) return 'Edge'
  if (ua.includes('opr/')) return 'Opera'
  if (ua.includes('vivaldi')) return 'Vivaldi'
  if (ua.includes('brave')) return 'Brave'
  if (ua.includes('chrome')) return 'Chrome'
  return 'Chromium'
}

let identityPromise: Promise<ExtensionIdentity> | null = null
let installIdPromise: Promise<string> | null = null
const tabSessionScope = (() => {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values)
    .map((value) => {
      return value.toString(36)
    })
    .join('')
})()

async function getInstallId(): Promise<string> {
  if (installIdPromise) {
    return installIdPromise
  }

  installIdPromise = (async () => {
    const existing = await chrome.storage.local.get('penguinBrowserInstallId')
    const storedInstallId = typeof existing.penguinBrowserInstallId === 'string' ? existing.penguinBrowserInstallId : ''
    if (storedInstallId) {
      return storedInstallId
    }

    const installId = createInstallId()
    await chrome.storage.local.set({ penguinBrowserInstallId: installId })
    return installId
  })().catch((error) => {
    installIdPromise = null
    throw error
  })

  return installIdPromise
}

async function getExtensionIdentity(): Promise<ExtensionIdentity> {
  if (identityPromise) {
    return identityPromise
  }

  identityPromise = (async () => {
    const browser = await detectBrowserName()
    // A runtime-only fallback is not a persistent installation identity. If storage is
    // unavailable, connect without installId so the relay can reject persistent sessions
    // instead of accepting a binding that a service-worker restart would immediately strand.
    const installId = await resolvePersistentInstallId(getInstallId)
    try {
      const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })
      return {
        browser,
        email: info.email || '',
        id: info.id || '',
        installId,
      }
    } catch {
      return {
        browser,
        email: '',
        id: '',
        installId,
      }
    }
  })()

  return identityPromise
}

const TAB_GROUP_COLOR: chrome.tabGroups.ColorEnum = 'cyan'
const TAB_GROUP_TITLE = 'Travel Browser'
const OWNED_TAB_GROUPS_STORAGE_KEY = 'penguinBrowserOwnedTabGroupsByWindow'

let childSessions: Map<string, { tabId: number; targetId?: string }> = new Map()
let nextSessionId = 1
let tabGroupQueue: Promise<void> = Promise.resolve()
let ownedTabGroupsPromise: Promise<Map<number, number>> | undefined
// Cache Target.setAutoAttach params so existing and future tabs enable OOPIF target events.
// This ensures Playwright can build the iframe frame tree when connecting over CDP.
let autoAttachParams: Protocol.Target.SetAutoAttachRequest | null = null

// Buffer for recording chunks when WebSocket isn't ready.
// Chunks are keyed by tabId and flushed when WebSocket opens.
interface BufferedChunk {
  tabId: number
  data?: number[]
  final?: boolean
  cancelled?: boolean
}
const recordingChunkBuffer: BufferedChunk[] = []
const MAX_RECORDING_CHUNK_BUFFER_BYTES = 8 * 1024 * 1024
let recordingChunkBufferBytes = 0
const abortedBufferedRecordings = new Set<number>()

function removeBufferedRecordingChunks(tabId: number): void {
  for (let index = recordingChunkBuffer.length - 1; index >= 0; index--) {
    const chunk = recordingChunkBuffer[index]
    if (chunk.tabId !== tabId) continue
    recordingChunkBufferBytes -= chunk.data?.length ?? 0
    recordingChunkBuffer.splice(index, 1)
  }
  recordingChunkBufferBytes = Math.max(0, recordingChunkBufferBytes)
}

/**
 * Flush buffered recording chunks to the WebSocket.
 * Called when WebSocket becomes ready.
 */
function flushRecordingChunkBuffer(ws: WebSocket): void {
  if (recordingChunkBuffer.length === 0) {
    return
  }

  logger.debug(`Flushing ${recordingChunkBuffer.length} buffered recording chunks`)

  while (recordingChunkBuffer.length > 0) {
    const chunk = recordingChunkBuffer.shift()!
    const { tabId, data, final, cancelled } = chunk

    recordingChunkBufferBytes = Math.max(0, recordingChunkBufferBytes - (data?.length ?? 0))

    if (cancelled) {
      ws.send(JSON.stringify({ method: 'recordingCancelled', params: { tabId } }))
      abortedBufferedRecordings.delete(tabId)
      continue
    }

    // Send metadata message first
    ws.send(
      JSON.stringify({
        method: 'recordingData',
        params: { tabId, final },
      }),
    )

    // Then send binary data if not final
    if (data && !final) {
      const buffer = new Uint8Array(data)
      ws.send(buffer)
    }
  }
}

class ConnectionManager {
  ws: WebSocket | null = null
  endpoint: RelayEndpoint | null = null
  private connectionPromise: Promise<void> | null = null
  private changingChoice = false
  preserveTabsOnDetach = false

  async ensureConnection(): Promise<void> {
    if (this.changingChoice) throw new Error('Application selection is changing')
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (store.getState().connectionState === 'extension-replaced') {
      throw new Error('Another Travel Browser extension is already connected')
    }

    // Reuse in-progress connection attempt - prevents races between user clicks and maintain loop
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    // Abort the underlying attempt when the global timeout fires. A plain
    // Promise.race leaves connect() running in the background; that attempt can
    // otherwise open a socket after callers already observed a timeout and leave
    // connecting tabs stranded forever.
    const GLOBAL_TIMEOUT_MS = 20000
    const abortController = new AbortController()
    let globalTimeout: ReturnType<typeof setTimeout> | undefined
    this.connectionPromise = Promise.race([
      this.connect(abortController.signal),
      new Promise<never>((_, reject) => {
        globalTimeout = setTimeout(() => {
          abortController.abort()
          reject(new Error('Connection timeout'))
        }, GLOBAL_TIMEOUT_MS)
      }),
    ])

    try {
      await this.connectionPromise
    } finally {
      if (globalTimeout) clearTimeout(globalTimeout)
      this.connectionPromise = null
    }
  }

  private async connect(abortSignal: AbortSignal): Promise<void> {
    const endpoint = await resolveExtensionEndpoint(RELAY_PORT)
    this.endpoint = endpoint
    logger.debug(`Connecting to ${endpoint.desktop ? "paired Travel Agent" : "standalone relay"}`)

    // Retry for up to 5 seconds with 1s intervals, then give up (maintain loop will retry later)
    // Using fewer attempts since maintainLoop retries every 3 seconds anyway
    const maxAttempts = 5
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fetch(`http://${RELAY_HOST}:${endpoint.port}`, {
          method: 'HEAD',
          signal: AbortSignal.any([abortSignal, AbortSignal.timeout(2000)]),
        })
        logger.debug('Server is available')
        break
      } catch {
        if (abortSignal.aborted) throw new Error('Connection timeout')
        if (attempt === maxAttempts - 1) {
          throw new Error('Server not available')
        }
        logger.debug(`Server not available, retrying... (attempt ${attempt + 1}/${maxAttempts})`)
        await sleep(1000)
        if (abortSignal.aborted) throw new Error('Connection timeout')
      }
    }

    const identity = await getExtensionIdentity()
    if (abortSignal.aborted) throw new Error('Connection timeout')
    const relayUrl = extensionSocketUrl(endpoint)
    if (identity.browser) {
      relayUrl.searchParams.set('browser', identity.browser)
    }
    if (identity.email) {
      relayUrl.searchParams.set('email', identity.email)
    }
    if (identity.id) {
      relayUrl.searchParams.set('id', identity.id)
    }
    if (identity.installId) {
      relayUrl.searchParams.set('installId', identity.installId)
    }
    if (typeof __PENGUIN_BROWSER_VERSION__ !== 'undefined') {
      relayUrl.searchParams.set('v', __PENGUIN_BROWSER_VERSION__)
    }
    logger.debug('Connecting browser transport')
    const socket = new WebSocket(relayUrl.toString(), extensionSocketProtocols(endpoint))

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        abortSignal.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => {
        settle(() => {
          try {
            socket.close()
          } catch {}
          reject(new Error('Connection timeout'))
        })
      }
      const timeout = setTimeout(() => {
        settle(() => {
          logger.debug('WebSocket connection TIMEOUT after 5 seconds')
          try {
            socket.close()
          } catch {}
          reject(new Error('Connection timeout'))
        })
      }, 5000)
      abortSignal.addEventListener('abort', onAbort, { once: true })

      socket.onopen = () => {
        settle(() => {
          logger.debug('WebSocket connected')

          // Flush any buffered recording chunks now that WebSocket is ready
          flushRecordingChunkBuffer(socket)

          resolve()
        })
      }

      socket.onerror = () => {
        logger.debug('WebSocket connection failed')
        settle(() => reject(new Error('WebSocket connection failed')))
      }

      socket.onclose = (event) => {
        logger.debug('WebSocket closed during connection:', { code: event.code, reason: event.reason })
        settle(() => {
          // Normalize 4002 rejection to consistent error message for callers to detect
          if (event.code === 4002 || event.reason === 'Extension Already In Use') {
            reject(new Error('Extension Already In Use'))
          } else {
            reject(new Error(`WebSocket closed: ${event.reason || event.code}`))
          }
        })
      }
    })

    if (abortSignal.aborted) {
      socket.close()
      throw new Error('Connection timeout')
    }
    this.ws = socket

    this.ws.onmessage = async (event: MessageEvent) => {
      let message: any
      try {
        message = JSON.parse(event.data)
      } catch (error: any) {
        logger.debug('Error parsing message:', error)
        sendMessage({ error: { code: -32700, message: `Error parsing message: ${error.message}` } })
        return
      }

      // Handle ping from server - respond with pong to keep service worker alive
      if (message.method === 'ping') {
        sendMessage({ method: 'pong' })
        return
      }

      // Handle createInitialTab - create a new tab when Playwright connects and no tabs exist
      // We use skipAttachedEvent: true because the relay's Target.setAutoAttach handler will send
      // Target.attachedToTarget for all targets in connectedTargets. If we also sent it here,
      // Playwright would receive a duplicate.
      //
      // This differs from the normal flow (user clicks extension icon) where:
      // 1. Extension attaches and sends Target.attachedToTarget to existing Playwright clients
      // 2. New Playwright clients that connect later get targets via Target.setAutoAttach
      //
      // But with createInitialTab, the SAME client that triggered the create is waiting for
      // Target.setAutoAttach - so we'd send the event twice to the same client.
      if (message.method === 'createInitialTab') {
        let createdTabId: number | undefined
        try {
          logger.debug('Creating initial tab for Playwright client')
          const tab = await createTabInPreferredWindow({ url: 'about:blank', active: false })
          if (tab.id) {
            createdTabId = tab.id
            setTabConnecting(tab.id)
            const { targetInfo, sessionId } = await attachTab(tab.id, { skipAttachedEvent: true })
            logger.debug('Initial tab created and connected:', tab.id, 'sessionId:', sessionId)
            sendMessage({
              id: message.id,
              result: {
                success: true,
                tabId: tab.id,
                sessionId,
                targetInfo,
              },
            })
          } else {
            throw new Error('Failed to create tab - no tab ID returned')
          }
        } catch (error: any) {
          logger.debug('Failed to create initial tab:', error)
          if (createdTabId !== undefined) {
            await chrome.tabs.remove(createdTabId).catch((cleanupError) => {
              logger.debug('Failed to close unattached initial tab:', cleanupError)
            })
          }
          sendMessage({ id: message.id, error: error.message })
        }
        return
      }

      // Handle recording commands
      if (message.method === 'startRecording') {
        try {
          const result = await handleStartRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to start recording:', error)
          sendMessage({ id: message.id, result: { success: false, error: error.message } })
        }
        return
      }

      if (message.method === 'stopRecording') {
        try {
          const result = await handleStopRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to stop recording:', error)
          sendMessage({ id: message.id, result: { success: false, error: error.message } })
        }
        return
      }

      if (message.method === 'isRecording') {
        try {
          const result = await handleIsRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to check recording status:', error)
          sendMessage({ id: message.id, result: { isRecording: false } })
        }
        return
      }

      if (message.method === 'cancelRecording') {
        try {
          const result = await handleCancelRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to cancel recording:', error)
          sendMessage({ id: message.id, result: { success: false, error: error.message } })
        }
        return
      }

      // Handle Ghost Browser API commands
      // This allows calling chrome.ghostPublicAPI, chrome.ghostProxies, chrome.projects
      // from the penguin-browser executor sandbox when running in Ghost Browser
      if (message.method === 'ghost-browser') {
        const params = message.params as GhostBrowserCommandParams
        const result = await handleGhostBrowserCommand(params, chrome)
        if (!result.success) {
          logger.error('Ghost Browser API error:', result.error)
        }
        // Auto-connect tabs created via ghostPublicAPI.openTab so they appear in context.pages()
        if (result.success && params.namespace === 'ghostPublicAPI' && params.method === 'openTab') {
          const tabId = result.result as number
          if (tabId) {
            logger.debug('Auto-connecting Ghost Browser tab:', tabId)
            setTabConnecting(tabId)
            await sleep(100)
            await attachTab(tabId)
          }
        }
        sendMessage({ id: message.id, result })
        return
      }

      const response: ExtensionResponseMessage = { id: message.id }
      try {
        response.result = await handleCommand(message as ExtensionCommandMessage)
      } catch (error: any) {
        logger.debug('Error handling command:', error)
        response.error = error.message
      }
      // logger.debug('Sending response:', response)
      sendMessage(response)
    }

    this.ws.onclose = (event: CloseEvent) => {
      this.handleClose(event.reason, event.code)
    }

    this.ws.onerror = () => {
      logger.debug('WebSocket connection failed')
    }

    chrome.debugger.onEvent.addListener(onDebuggerEvent)
    chrome.debugger.onDetach.addListener(onDebuggerDetach)

    logger.debug('Connection established')
  }

  private handleClose(reason: string, code: number): void {
    // Log memory at disconnect time to help diagnose memory-related terminations
    try {
      // @ts-ignore - performance.memory is Chrome-specific
      const mem = performance.memory
      if (mem) {
        const formatMB = (b: number) => (b / 1024 / 1024).toFixed(2) + 'MB'
        logger.warn(
          `DISCONNECT MEMORY: used=${formatMB(mem.usedJSHeapSize)} total=${formatMB(mem.totalJSHeapSize)} limit=${formatMB(mem.jsHeapSizeLimit)}`,
        )
      }
    } catch {}
    logger.warn(`DISCONNECT: WS closed code=${code} reason=${reason || 'none'} stack=${getCallStack()}`)

    chrome.debugger.onEvent.removeListener(onDebuggerEvent)
    chrome.debugger.onDetach.removeListener(onDebuggerDetach)

    const isExtensionReplaced = reason === 'Extension Replaced' || code === 4001
    const isExtensionInUse = reason === 'Extension Already In Use' || code === 4002
    this.preserveTabsOnDetach = !(isExtensionReplaced || isExtensionInUse)

    const { tabs } = store.getState()

    for (const [tabId] of tabs) {
      void detachDebugger(tabId).catch((err) => {
        logger.debug('Error detaching from tab:', tabId, err.message)
      })
    }

    childSessions.clear()
    this.ws = null

    // Only one extension can connect to the relay server at a time.
    // Code 4001: Another extension replaced this one (this extension was idle)
    // Code 4002: This extension tried to connect but another is actively in use
    if (isExtensionReplaced) {
      logger.debug('Disconnected: another Travel Browser extension connected (this one was idle)')
      store.setState({
        tabs: new Map(),
        connectionState: 'extension-replaced',
        errorText: 'Another Travel Browser extension took over the connection',
      })
      return
    }

    if (isExtensionInUse) {
      logger.debug('Rejected: another Travel Browser extension is actively in use')
      store.setState({
        tabs: new Map(),
        connectionState: 'extension-replaced',
        errorText: 'Another Travel Browser extension is actively in use',
      })
      return
    }

    // For normal disconnects, set tabs to 'connecting' state and let maintain loop handle reconnect
    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      for (const [tabId, tab] of newTabs) {
        newTabs.set(tabId, { ...tab, state: 'connecting' })
      }
      return { tabs: newTabs, connectionState: 'idle', errorText: undefined }
    })
  }

  async setChoice(choice: ConnectionChoice): Promise<void> {
    if (this.changingChoice || this.ws || this.connectionPromise) {
      throw new Error('Close the connected application before changing the pairing. Active tasks cannot switch applications.')
    }
    this.changingChoice = true
    try {
      // Authorization must never move from the previous application to another one.
      await disconnectEverything()
      await chrome.storage.local.set({ [CONNECTION_CHOICE_KEY]: choice })
      this.endpoint = null
      store.setState({ connectionState: 'idle', errorText: undefined })
    } finally { this.changingChoice = false }
  }

  async maintainLoop(): Promise<void> {
    while (true) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        await sleep(1000)
        continue
      }

      // When another Travel Browser extension took over, poll until no same-key replacement is
      // connected anymore. Reclaiming while another worker is merely idle is racy: a fresh
      // replacement reports activeTargets=0 before it re-attaches tabs, so the old worker can
      // steal the slot back and disconnect the live browser instance.
      if (store.getState().connectionState === 'extension-replaced') {
        try {
          const identity = await getExtensionIdentity()
          const endpoint = await resolveExtensionEndpoint(RELAY_PORT)
          const statusUrl = new URL(`http://${RELAY_HOST}:${endpoint.port}/extension/status`)
          if (identity.browser) statusUrl.searchParams.set('browser', identity.browser)
          if (identity.email) statusUrl.searchParams.set('email', identity.email)
          if (identity.id) statusUrl.searchParams.set('id', identity.id)
          if (identity.installId) statusUrl.searchParams.set('installId', identity.installId)
          const response = await fetch(statusUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
          })
          const data = (await response.json()) as { connected: boolean; activeTargets: number }
          const slotAvailable = !data.connected
          if (slotAvailable) {
            store.setState({ connectionState: 'idle', errorText: undefined })
            logger.debug(
              'Extension slot is free (connected:',
              data.connected,
              'activeTargets:',
              data.activeTargets,
              '), cleared error state',
            )
          } else {
            logger.debug('Extension slot still taken (activeTargets:', data.activeTargets, '), will retry...')
          }
        } catch {
          logger.debug('Server not available, will retry...')
        }
        await sleep(3000)
        continue
      }

      // Ensure tabs are in 'connecting' state when WS is not connected
      // This handles edge cases where handleClose wasn't called or state got out of sync
      const currentTabs = store.getState().tabs
      const hasConnectedTabs = Array.from(currentTabs.values()).some((t) => t.state === 'connected')
      if (hasConnectedTabs) {
        store.setState((state) => {
          const newTabs = new Map(state.tabs)
          for (const [tabId, tab] of newTabs) {
            if (tab.state === 'connected') {
              newTabs.set(tabId, { ...tab, state: 'connecting' })
            }
          }
          return { tabs: newTabs }
        })
      }

      // Try to connect silently in background - don't show 'connecting' badge
      // Individual tab states will show 'connecting' when user explicitly clicks
      try {
        await this.ensureConnection()
        store.setState({ connectionState: 'connected' })

        // Re-attach any tabs that were in 'connecting' state (from a previous disconnect)
        const tabsToReattach = Array.from(store.getState().tabs.entries())
          .filter(([_, tab]) => tab.state === 'connecting')
          .map(([tabId]) => tabId)

        for (const tabId of tabsToReattach) {
          // Re-check state before attaching - might have been attached by user click
          const currentTab = store.getState().tabs.get(tabId)
          if (!currentTab || currentTab.state !== 'connecting') {
            logger.debug('Skipping reattach, tab state changed:', tabId, currentTab?.state)
            continue
          }

          try {
            await chrome.tabs.get(tabId)
            await attachTab(tabId)
            logger.debug('Successfully re-attached tab:', tabId)
          } catch (error: any) {
            logger.debug('Failed to re-attach tab:', tabId, error.message)
            store.setState((state) => {
              const newTabs = new Map(state.tabs)
              newTabs.delete(tabId)
              return { tabs: newTabs }
            })
          }
        }
        this.preserveTabsOnDetach = false
      } catch (error: any) {
        logger.debug('Connection attempt failed:', error.message)
        // Check if rejected because another extension is actively in use
        if (error.message === 'Extension Already In Use') {
          store.setState({
            connectionState: 'extension-replaced',
            errorText: 'Another Travel Browser extension is actively in use',
          })
        } else {
          store.setState({ connectionState: 'idle', errorText: error.message })
        }
      }

      await sleep(3000)
    }
  }
}

export const connectionManager = new ConnectionManager()

export const store = createStore<ExtensionState>(() => ({
  tabs: new Map(),
  connectionState: 'idle',
  currentTabId: undefined,
  preferredWindowId: undefined,
  errorText: undefined,
}))

// @ts-ignore
globalThis.toggleExtensionForActiveTab = toggleExtensionForActiveTab
// @ts-ignore
globalThis.disconnectEverything = disconnectEverything
// @ts-ignore
globalThis.getExtensionState = () => store.getState()

declare global {
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  var getExtensionState: () => ExtensionState
  var disconnectEverything: () => Promise<void>
}

const MAX_LOG_STRING_LENGTH = 2000

function truncateLogString(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value
  }
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}…[truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`
}

function safeSerialize(arg: any): string {
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`
  if (typeof arg === 'symbol') return String(arg)
  if (typeof arg === 'string') return truncateLogString(arg)
  if (arg instanceof Error) return truncateLogString(arg.stack || arg.message || String(arg))
  if (typeof arg === 'object') {
    try {
      const seen = new WeakSet()
      const serialized = JSON.stringify(arg, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]'
          seen.add(value)
          if (value instanceof Map) return { dataType: 'Map', value: Array.from(value.entries()) }
          if (value instanceof Set) return { dataType: 'Set', value: Array.from(value.values()) }
        }
        return value
      })
      return truncateLogString(serialized)
    } catch {
      return truncateLogString(String(arg))
    }
  }
  return truncateLogString(String(arg))
}

function sendLog(level: string, args: any[]) {
  sendMessage({
    method: 'log',
    params: { level, args: args.map(safeSerialize) },
  })
}

export const logger = {
  log: (...args: any[]) => {
    console.log(...args)
    sendLog('log', args)
  },
  debug: (...args: any[]) => {
    console.debug(...args)
    sendLog('debug', args)
  },
  info: (...args: any[]) => {
    console.info(...args)
    sendLog('info', args)
  },
  warn: (...args: any[]) => {
    console.warn(...args)
    sendLog('warn', args)
  },
  error: (...args: any[]) => {
    console.error(...args)
    sendLog('error', args)
  },
}

function getCallStack(): string {
  const stack = new Error().stack || ''
  return stack.split('\n').slice(2, 6).join(' <- ').replace(/\s+/g, ' ')
}

self.addEventListener('error', (event) => {
  const error = event.error
  const stack = error?.stack || `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
  logger.error('Uncaught error:', stack)
})

self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const stack = reason?.stack || String(reason)
  logger.error('Unhandled promise rejection:', stack)
})

let messageCount = 0
export function sendMessage(message: any): void {
  if (connectionManager.ws?.readyState === WebSocket.OPEN) {
    try {
      connectionManager.ws.send(JSON.stringify(message))
      // Check memory periodically (every ~100 messages)
      if (++messageCount % 100 === 0) {
        checkMemory()
      }
    } catch (error: any) {
      console.debug('ERROR sending message:', error, 'message type:', message.method || 'response')
    }
  }
}

async function getPreferredWindowId(): Promise<number | undefined> {
  const { preferredWindowId, currentTabId } = store.getState()
  if (preferredWindowId !== undefined) {
    try {
      await chrome.windows.get(preferredWindowId)
      return preferredWindowId
    } catch {
      store.setState({ preferredWindowId: undefined })
    }
  }

  if (currentTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(currentTabId)
      if (tab.windowId !== undefined) {
        return tab.windowId
      }
    } catch {}
  }

  try {
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false })
    return focusedWindow.id
  } catch {
    return undefined
  }
}

async function createTabInPreferredWindow(options: { url: string; active: boolean }): Promise<chrome.tabs.Tab> {
  const windowId = await getPreferredWindowId()
  const createProperties: chrome.tabs.CreateProperties = {
    url: options.url,
    active: options.active,
    ...(windowId !== undefined ? { windowId } : {}),
  }

  try {
    return await chrome.tabs.create(createProperties)
  } catch (error) {
    logger.debug('Could not create tab in preferred window, falling back:', (error as Error).message)
    return await chrome.tabs.create({ url: options.url, active: options.active })
  }
}

async function getOwnedTabGroups(): Promise<Map<number, number>> {
  if (!ownedTabGroupsPromise) {
    ownedTabGroupsPromise = (async () => {
      try {
        const stored = await chrome.storage.session.get(OWNED_TAB_GROUPS_STORAGE_KEY)
        const value = stored[OWNED_TAB_GROUPS_STORAGE_KEY]
        const groups = new Map<number, number>()
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [windowIdValue, groupIdValue] of Object.entries(value)) {
            const windowId = Number(windowIdValue)
            if (Number.isInteger(windowId) && typeof groupIdValue === 'number' && Number.isInteger(groupIdValue)) {
              groups.set(windowId, groupIdValue)
            }
          }
        }
        return groups
      } catch (error) {
        logger.debug('Could not restore owned tab groups:', (error as Error).message)
        return new Map<number, number>()
      }
    })()
  }
  return await ownedTabGroupsPromise
}

async function persistOwnedTabGroups(groups: Map<number, number>): Promise<void> {
  try {
    await chrome.storage.session.set({
      [OWNED_TAB_GROUPS_STORAGE_KEY]: Object.fromEntries(
        Array.from(groups.entries()).map(([windowId, groupId]) => [String(windowId), groupId]),
      ),
    })
  } catch (error) {
    // Keep the in-memory ownership map usable even if session storage is briefly unavailable.
    logger.debug('Could not persist owned tab groups:', (error as Error).message)
  }
}

async function rememberOwnedTabGroup(windowId: number, groupId: number): Promise<void> {
  const groups = await getOwnedTabGroups()
  if (groups.get(windowId) === groupId) return
  groups.set(windowId, groupId)
  await persistOwnedTabGroups(groups)
}

async function forgetOwnedTabGroup(windowId: number, expectedGroupId?: number): Promise<void> {
  const groups = await getOwnedTabGroups()
  if (!groups.has(windowId)) return
  if (expectedGroupId !== undefined && groups.get(windowId) !== expectedGroupId) return
  groups.delete(windowId)
  await persistOwnedTabGroups(groups)
}

async function getValidatedOwnedTabGroupId(windowId: number): Promise<number | undefined> {
  const groups = await getOwnedTabGroups()
  const groupId = groups.get(windowId)
  if (groupId === undefined) return undefined

  try {
    const group = await chrome.tabGroups.get(groupId)
    if (group.windowId === windowId) return groupId
    logger.debug('Discarding owned tab group with mismatched window:', groupId, group.windowId, windowId)
  } catch {
    logger.debug('Discarding missing owned tab group:', groupId, 'for window:', windowId)
  }

  await forgetOwnedTabGroup(windowId, groupId)
  return undefined
}

async function syncTabGroup(): Promise<void> {
  try {
    // Include 'connecting' tabs in the group only when the relay is alive, so that
    // tabs the user drags into the group stay visible while attaching. When the relay
    // is dead all tabs are 'connecting' (waiting for reconnect) and the group should
    // be cleaned up. The onUpdated handler (line ~1601) already guards against the
    // ungroup→disconnect loop for 'connecting' tabs, so excluding them here is safe.
    const { connectionState } = store.getState()
    const isRelayConnected = connectionState === 'connected'
    const connectedTabIds = Array.from(store.getState().tabs.entries())
      .filter(([_, info]) => info.state === 'connected' || (info.state === 'connecting' && isRelayConnected))
      .map(([tabId]) => tabId)
    const allTabs = await chrome.tabs.query({})
    const connectedTabIdSet = new Set(connectedTabIds)
    const connectedTabsByWindow = new Map<number, number[]>()
    for (const tab of allTabs) {
      if (tab.id === undefined || !connectedTabIdSet.has(tab.id)) continue
      const tabIds = connectedTabsByWindow.get(tab.windowId) ?? []
      tabIds.push(tab.id)
      connectedTabsByWindow.set(tab.windowId, tabIds)
    }

    // Ownership is recorded when this extension creates a group. Never discover or
    // adopt groups by title: users are allowed to have their own "Travel Browser"
    // groups, and every browser window needs a separate extension-owned group.
    const ownedGroups = await getOwnedTabGroups()
    const windowIds = new Set([...ownedGroups.keys(), ...connectedTabsByWindow.keys()])

    for (const windowId of windowIds) {
      const desiredTabIds = connectedTabsByWindow.get(windowId) ?? []
      let groupId = await getValidatedOwnedTabGroupId(windowId)

      if (desiredTabIds.length === 0) {
        if (groupId === undefined) continue
        const tabsInGroup = await chrome.tabs.query({ groupId })
        const tabIdsToUngroup = tabsInGroup.map((tab) => tab.id).filter((id): id is number => id !== undefined)
        if (tabIdsToUngroup.length > 0) {
          await chrome.tabs.ungroup(tabIdsToUngroup)
        }
        await forgetOwnedTabGroup(windowId, groupId)
        logger.debug('Cleared owned Travel Browser group:', groupId, 'in window:', windowId)
        continue
      }

      if (groupId === undefined) {
        // Without an explicit create window Chrome uses the currently focused
        // window. If focus changes while this queued sync is waiting, it can move
        // every desired tab out of its original window before creating the group.
        groupId = await chrome.tabs.group({
          tabIds: desiredTabIds,
          createProperties: { windowId },
        })
        // Record ownership before styling. If the update is interrupted by an MV3
        // worker suspension, the next sync can still identify and repair our group.
        await rememberOwnedTabGroup(windowId, groupId)
        await chrome.tabGroups.update(groupId, { title: TAB_GROUP_TITLE, color: TAB_GROUP_COLOR })
        logger.debug('Created owned tab group:', groupId, 'in window:', windowId, 'with tabs:', desiredTabIds)
        continue
      }

      const tabsInGroup = await chrome.tabs.query({ groupId })
      const tabIdsInGroup = new Set(tabsInGroup.map((tab) => tab.id).filter((id): id is number => id !== undefined))
      const desiredTabIdSet = new Set(desiredTabIds)
      const tabsToAdd = desiredTabIds.filter((tabId) => !tabIdsInGroup.has(tabId))
      const tabsToRemove = Array.from(tabIdsInGroup).filter((tabId) => !desiredTabIdSet.has(tabId))

      // Add first so the owned group cannot disappear between an ungroup and a
      // regroup when all of its previous tabs were disconnected at once.
      if (tabsToAdd.length > 0) {
        await chrome.tabs.group({ tabIds: tabsToAdd, groupId })
        logger.debug('Added tabs to owned group:', groupId, tabsToAdd)
      }
      if (tabsToRemove.length > 0) {
        await chrome.tabs.ungroup(tabsToRemove)
        logger.debug('Removed tabs from owned group:', groupId, tabsToRemove)
      }
      await chrome.tabGroups.update(groupId, { title: TAB_GROUP_TITLE, color: TAB_GROUP_COLOR })
    }
  } catch (error: any) {
    logger.debug('Failed to sync tab group:', error.message)
  }
}

export function getTabBySessionId(sessionId: string): { tabId: number; tab: TabInfo } | undefined {
  for (const [tabId, tab] of store.getState().tabs) {
    if (tab.sessionId === sessionId) {
      return { tabId, tab }
    }
  }
  return undefined
}

function getTabByTargetId(targetId: string): { tabId: number; tab: TabInfo } | undefined {
  for (const [tabId, tab] of store.getState().tabs) {
    if (tab.targetId === targetId) {
      return { tabId, tab }
    }
  }
  return undefined
}

function emitChildDetachesForTab(tabId: number): void {
  const childEntries = Array.from(childSessions.entries()).filter(([_, parentTab]) => parentTab.tabId === tabId)

  childEntries.forEach(([childSessionId, parentTab]) => {
    const childDetachParams: Protocol.Target.DetachedFromTargetEvent = parentTab.targetId
      ? { sessionId: childSessionId, targetId: parentTab.targetId }
      : { sessionId: childSessionId }
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: childDetachParams,
      },
    })
    logger.debug('Cleaning up child session:', childSessionId, 'for tab:', tabId)
    childSessions.delete(childSessionId)
  })
}

// Resolve which tab a CDP command targets by checking sessionId sources in priority order:
// 1. Top-level sessionId (the CDP session the command was sent on)
// 2. params.sessionId (e.g. Target.detachFromTarget on the root session, see #40)
// 3. params.targetId (e.g. Target.closeTarget)
function getTabForCommand(msg: ExtensionCommandMessage): { tabId: number; tab: TabInfo } | undefined {
  const sessionId = msg.params.sessionId
  if (sessionId) {
    const found = getTabBySessionId(sessionId)
    if (found) {
      return found
    }
    const child = childSessions.get(sessionId)
    if (child) {
      const tab = store.getState().tabs.get(child.tabId)
      if (tab) {
        return { tabId: child.tabId, tab }
      }
    }
  }

  const paramsSessionId =
    msg.params.params && 'sessionId' in msg.params.params && typeof msg.params.params.sessionId === 'string'
      ? msg.params.params.sessionId
      : undefined
  if (paramsSessionId) {
    const found = getTabBySessionId(paramsSessionId)
    if (found) {
      return found
    }
    const child = childSessions.get(paramsSessionId)
    if (child) {
      const tab = store.getState().tabs.get(child.tabId)
      if (tab) {
        return { tabId: child.tabId, tab }
      }
    }
  }

  const targetId =
    msg.params.params && 'targetId' in msg.params.params && typeof msg.params.params.targetId === 'string'
      ? msg.params.params.targetId
      : undefined
  if (targetId) {
    return getTabByTargetId(targetId)
  }

  return undefined
}

async function handleCommand(msg: ExtensionCommandMessage): Promise<any> {
  if (msg.method !== 'forwardCDPCommand') return

  const resolved = getTabForCommand(msg)
  let targetTabId = resolved?.tabId
  let targetTab = resolved?.tab

  const debuggee = targetTabId ? { tabId: targetTabId } : undefined

  // Root-level Target.setAutoAttach must apply to all connected tabs since
  // CDP auto-attach is per-debugger-session. Without this, OOPIF targets never attach.
  if (msg.params.method === 'Target.setAutoAttach' && !msg.params.sessionId) {
    const params = msg.params.params as Protocol.Target.SetAutoAttachRequest | undefined
    if (!params) {
      return {}
    }

    autoAttachParams = params
    const connectedTabIds = Array.from(store.getState().tabs.entries())
      .filter(([_, info]) => info.state === 'connected')
      .map(([tabId]) => tabId)

    await Promise.all(
      connectedTabIds.map(async (tabId) => {
        try {
          await sendCommandWithTimeout({ tabId }, 'Target.setAutoAttach', params, 10000)
        } catch (error) {
          logger.debug('Failed to set auto-attach for tab:', tabId, error)
        }
      }),
    )

    return {}
  }

  // TODO disable network things?
  // if (msg.params.method === 'Network.enable' && msg.params.source !== 'penguin-browser') {
  //   logger.debug('Skipping Network.enable from non-penguin-browser CDP client:', msg.params.sessionId)
  //   return {}
  // }

  switch (msg.params.method) {
    case 'Runtime.enable': {
      if (!debuggee) {
        throw new Error(`No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`)
      }
      // Keep Runtime.enable bound to the incoming child sessionId for OOPIF iframes.
      // If we send Runtime.enable on the tab root session, child iframe targets never
      // emit Runtime.executionContextCreated and frame locators can hang.
      const runtimeSession: chrome.debugger.DebuggerSession = {
        ...debuggee,
        sessionId: msg.params.sessionId !== targetTab?.sessionId ? msg.params.sessionId : undefined,
      }
      // When multiple Playwright clients connect to the same tab, each calls Runtime.enable.
      // If Runtime is already enabled, the enable call succeeds but Chrome doesn't re-send
      // Runtime.executionContextCreated events - those were already sent to the first client.
      // By disabling first, we force Chrome to re-send all execution context events when we
      // re-enable, ensuring the new client receives them. The relay server waits for the
      // executionContextCreated events before returning. See cdp-timing.md for details.
      try {
        await sendCommandWithTimeout(runtimeSession, 'Runtime.disable', undefined, 10000)
        await sleep(50)
      } catch (e) {
        logger.debug('Error disabling Runtime (ignoring):', e)
      }
      return await sendCommandWithTimeout(runtimeSession, 'Runtime.enable', msg.params.params, 10000)
    }

    case 'Target.createTarget': {
      const url = msg.params.params?.url || 'about:blank'
      logger.debug('Creating new tab with URL:', url)
      const tab = await createTabInPreferredWindow({ url, active: false })
      if (!tab.id) throw new Error('Failed to create tab')
      try {
        setTabConnecting(tab.id)
        logger.debug('Created tab:', tab.id, 'waiting for it to load...')
        await sleep(100)
        const { targetInfo } = await attachTab(tab.id)
        return { targetId: targetInfo.targetId } satisfies Protocol.Target.CreateTargetResponse
      } catch (error) {
        // A failed Target.createTarget has no Page to return to Playwright, so the caller cannot
        // close the browser tab. Remove it here instead of stranding a blank or half-loaded tab.
        await chrome.tabs.remove(tab.id).catch((cleanupError) => {
          logger.debug('Failed to close tab after debugger attach failure:', cleanupError)
        })
        throw error
      }
    }

    case 'Target.closeTarget': {
      if (!targetTabId) {
        logger.log(`Target not found: ${msg.params.params?.targetId}`)
        return { success: false } satisfies Protocol.Target.CloseTargetResponse
      }
      await chrome.tabs.remove(targetTabId)
      return { success: true } satisfies Protocol.Target.CloseTargetResponse
    }

    case 'Page.setDownloadBehavior': {
      if (!debuggee) {
        throw new Error(`No debuggee found for Page.setDownloadBehavior (sessionId: ${msg.params.sessionId})`)
      }
      try {
        return await sendCommandWithTimeout(debuggee, msg.params.method, msg.params.params, 10000)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Current Chromium routes this deprecated Page command through a
        // browser-level handler that chrome.debugger cannot access. Playwright
        // download events and download.saveAs() continue to work, so treat this
        // specific platform limitation as a no-op instead of an extension error.
        if (message.includes('Cannot not access browser-level commands')) {
          return {}
        }
        throw error
      }
    }
  }

  if (!debuggee || !targetTab) {
    // Target.detachFromTarget is best-effort — no-op if the session is already gone (#40).
    if (msg.params.method === 'Target.detachFromTarget') {
      return {}
    }

    throw new Error(
      `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId} params: ${JSON.stringify(msg.params.params || null)}`,
    )
  }

  logger.debug('CDP command:', msg.params.method, 'for tab:', targetTabId)

  const debuggerSession: chrome.debugger.DebuggerSession = {
    ...debuggee,
    sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : undefined,
  }

  const timeout = FAST_CDP_COMMAND_TIMEOUT_MS.get(msg.params.method)
  if (timeout) {
    return await sendCommandWithTimeout(debuggerSession, msg.params.method, msg.params.params, timeout)
  }
  return await chrome.debugger.sendCommand(debuggerSession, msg.params.method, msg.params.params)
}

// CDP events dropped before sending over WebSocket to the relay.
// Only events no Playwright API depends on. The relay also filters these server-side
// for backwards compatibility with old extensions.
// NOTE: *ExtraInfo events feed Playwright's ResponseExtraInfoTracker (request/response.allHeaders()).
// webSocketFrame* events feed page.on('websocket'). Both must be forwarded.
// See: https://private-project.invalid/repository/issues/96
const DROPPED_CDP_EVENTS = new Set(['Network.dataReceived', 'Network.resourceChangedPriority'])

function onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: any): void {
  if (DROPPED_CDP_EVENTS.has(method)) {
    return
  }

  const tab = source.tabId ? store.getState().tabs.get(source.tabId) : undefined
  if (!tab) return

  logger.debug('Forwarding CDP event:', method, 'from tab:', source.tabId)

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    const targetUrl = params.targetInfo?.url as string | undefined
    // Filter out restricted child targets (other extensions' chrome-extension:// iframes,
    // chrome:// pages, devtools://, etc). Without this, Chrome's debugger API throws
    // "Cannot access a chrome-extension:// URL of a different extension" when the relay
    // tries to send commands (e.g. Runtime.runIfWaitingForDebugger) to these targets,
    // crashing the entire debugger session. See: https://private-project.invalid/repository/issues/18
    if (isRestrictedUrl(targetUrl)) {
      logger.debug(
        'Ignoring restricted child target:',
        targetUrl,
        'sessionId:',
        params.sessionId,
        'for tab:',
        source.tabId,
      )
      // Detach from the restricted child target to clean up. This command is sent on
      // the parent tab's debugger session (not the child), so it won't trigger the
      // restricted URL error.
      if (source.tabId) {
        chrome.debugger
          .sendCommand({ tabId: source.tabId }, 'Target.detachFromTarget', { sessionId: params.sessionId })
          .catch((e) => {
            logger.debug('Failed to detach restricted child target (expected):', e)
          })
      }
      return
    }

    logger.debug('Child target attached:', params.sessionId, 'for tab:', source.tabId)
    const targetId = params.targetInfo?.targetId as string | undefined
    childSessions.set(params.sessionId, { tabId: source.tabId!, targetId })
  }

  if (method === 'Target.detachedFromTarget' && params?.sessionId) {
    const mainTab = getTabBySessionId(params.sessionId)
    if (mainTab) {
      logger.debug('Main tab detached via CDP event:', mainTab.tabId, 'sessionId:', params.sessionId)
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        newTabs.delete(mainTab.tabId)
        return { tabs: newTabs }
      })
      emitChildDetachesForTab(mainTab.tabId)
    } else {
      logger.debug('Child target detached:', params.sessionId)
      childSessions.delete(params.sessionId)
    }
  }

  sendMessage({
    method: 'forwardCDPEvent',
    params: {
      sessionId: source.sessionId || tab.sessionId,
      method,
      params,
    },
  })
}

function onDebuggerDetach(source: chrome.debugger.Debuggee, reason: `${chrome.debugger.DetachReason}`): void {
  const tabId = source.tabId
  if (!tabId || !store.getState().tabs.has(tabId)) {
    logger.debug('Ignoring debugger detach event for untracked tab:', tabId)
    return
  }

  // The Chrome debugger banner is an explicit user cancellation and must win
  // even while a relay reconnect is preserving tabs.
  if (reason === chrome.debugger.DetachReason.CANCELED_BY_USER) {
    logger.warn(`DISCONNECT: Chrome debugger canceled by user tabId=${tabId}`)
    for (const [detachedTabId, tab] of store.getState().tabs.entries()) {
      void restoreRestrictedIframes(detachedTabId)
      if (tab.sessionId && tab.targetId) {
        sendMessage({
          method: 'forwardCDPEvent',
          params: {
            method: 'Target.detachedFromTarget',
            params: { sessionId: tab.sessionId, targetId: tab.targetId },
          },
        })
      }
      emitChildDetachesForTab(detachedTabId)
    }

    connectionManager.preserveTabsOnDetach = false
    store.setState({ tabs: new Map(), connectionState: 'idle', errorText: undefined })
    return
  }

  if (connectionManager.preserveTabsOnDetach) {
    logger.debug('Ignoring debugger detach during relay reconnect:', tabId, reason)
    return
  }

  logger.warn(`DISCONNECT: onDebuggerDetach tabId=${tabId} reason=${reason}`)

  const detachTabFromPlaywright = (detachedTabId: number, tab: TabInfo) => {
    if (tab.sessionId && tab.targetId) {
      sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: { sessionId: tab.sessionId, targetId: tab.targetId },
        },
      })
    }
    emitChildDetachesForTab(detachedTabId)
  }

  const tab = store.getState().tabs.get(tabId)
  if (tab) {
    // A failed attach emits target_closed while this entry is still connecting.
    // Its attach finally block owns restoration; restoring here would race the retry.
    if (tab.state === 'connected') {
      void restoreRestrictedIframes(tabId)
    }
    detachTabFromPlaywright(tabId, tab)
  }

  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    newTabs.delete(tabId)
    return { tabs: newTabs }
  })
}

type AttachTabResult = {
  targetInfo: Protocol.Target.TargetInfo
  sessionId: string
}

// Temporarily move chrome-extension:// iframes out of the live page DOM before attaching the debugger.
// Chrome's chrome.debugger.attach API refuses to attach to tabs that contain frames from
// other extensions ("Cannot access a chrome-extension:// URL of different extension").
// Extensions like LastPass, SurfingKeys, etc. inject chrome-extension:// iframes into every
// page, breaking debugger attachment. Each iframe is kept inside an inert template placeholder
// at its original position. Failed attaches restore immediately; successful attaches restore on
// debugger detach because reinserting a restricted frame while attached makes Chrome detach again.
// The DOM placeholder supports recovery after a service-worker restart, while isolated-world
// records retain the original parent if page code removes a placeholder during the attachment.
// See: https://private-project.invalid/repository/issues/18
async function temporarilyRemoveRestrictedIframes(tabId: number): Promise<number> {
  try {
    const results = await chrome.scripting.executeScript({
      // allFrames: true ensures we also scan same-origin subframes, not just the top document.
      target: { tabId, allFrames: true },
      func: (ownExtIds: string[]) => {
        type PendingRestrictedIframe = {
          iframe: HTMLIFrameElement
          marker: HTMLTemplateElement
          parent: ParentNode
          nextSibling: ChildNode | null
        }
        type RestrictedIframeGlobal = typeof globalThis & {
          __penguinBrowserPendingRestrictedIframes?: PendingRestrictedIframe[]
        }

        const collectOpenRoots = (root: ParentNode): ParentNode[] => {
          return [
            root,
            ...Array.from(root.querySelectorAll('*')).flatMap((element) => {
              return element.shadowRoot ? collectOpenRoots(element.shadowRoot) : []
            }),
          ]
        }

        const isolatedGlobal = globalThis as RestrictedIframeGlobal
        const pending: PendingRestrictedIframe[] = isolatedGlobal.__penguinBrowserPendingRestrictedIframes || []
        const markerOwner = ownExtIds[0] || 'penguin-browser'
        const roots: ParentNode[] = collectOpenRoots(document)
        const restrictedIframes: HTMLIFrameElement[] = roots.flatMap((root) => {
          return Array.from(root.querySelectorAll('iframe')).filter((iframe) => {
            const src = iframe.src || iframe.getAttribute('src') || ''
            if (!src.startsWith('chrome-extension://')) {
              return false
            }
            const extId = src.replace('chrome-extension://', '').split('/')[0]
            return !ownExtIds.includes(extId)
          })
        })

        const newPending: PendingRestrictedIframe[] = restrictedIframes.flatMap((iframe) => {
          const parent = iframe.parentNode
          if (!parent) {
            return []
          }

          const marker = document.createElement('template')
          marker.setAttribute('data-penguin-browser-restricted-iframe', markerOwner)
          const nextSibling = iframe.nextSibling
          iframe.replaceWith(marker)
          marker.content.append(iframe)
          return [{ iframe, marker, parent, nextSibling }]
        })

        isolatedGlobal.__penguinBrowserPendingRestrictedIframes = [...pending, ...newPending]
        return newPending.length
      },
      args: [OUR_EXTENSION_IDS],
    })
    const totalRemoved = results.reduce((sum, r) => sum + (r.result ?? 0), 0)
    if (totalRemoved > 0) {
      logger.debug(`Temporarily removed ${totalRemoved} restricted chrome-extension:// iframe(s) from tab:`, tabId)
    }
    return totalRemoved
  } catch (e) {
    // Scripting may fail on restricted pages (chrome://, about:, etc.) — that's fine,
    // those pages won't have extension iframes anyway.
    logger.debug('Could not remove restricted iframes (expected on some pages):', (e as Error).message)
    return 0
  }
}

async function restoreRestrictedIframes(tabId: number): Promise<number> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (markerOwner: string) => {
        type PendingRestrictedIframe = {
          iframe: HTMLIFrameElement
          marker: HTMLTemplateElement
          parent: ParentNode
          nextSibling: ChildNode | null
        }
        type RestrictedIframeGlobal = typeof globalThis & {
          __penguinBrowserPendingRestrictedIframes?: PendingRestrictedIframe[]
        }

        const collectOpenRoots = (root: ParentNode): ParentNode[] => {
          return [
            root,
            ...Array.from(root.querySelectorAll('*')).flatMap((element) => {
              return element.shadowRoot ? collectOpenRoots(element.shadowRoot) : []
            }),
          ]
        }

        const isolatedGlobal = globalThis as RestrictedIframeGlobal
        const pending: PendingRestrictedIframe[] = isolatedGlobal.__penguinBrowserPendingRestrictedIframes || []
        isolatedGlobal.__penguinBrowserPendingRestrictedIframes = []

        const restoredFromRecords = pending.reduce((restored, record) => {
          if (record.iframe.isConnected) {
            record.marker.remove()
            return restored
          }
          if (record.marker.parentNode) {
            record.marker.replaceWith(record.iframe)
            return restored + 1
          }

          const referenceNode = record.nextSibling?.parentNode === record.parent ? record.nextSibling : null
          record.parent.insertBefore(record.iframe, referenceNode)
          return restored + 1
        }, 0)

        // A previous service-worker instance may have left inert placeholders without records
        // in this isolated world. Restore those markers directly from the document as a fallback.
        const roots: ParentNode[] = collectOpenRoots(document)
        const orphanedMarkers: HTMLTemplateElement[] = roots.flatMap((root) => {
          return Array.from(root.querySelectorAll('template')).filter((template) => {
            return template.getAttribute('data-penguin-browser-restricted-iframe') === markerOwner
          })
        })
        const restoredFromMarkers = orphanedMarkers.reduce((restored, marker) => {
          const iframe = marker.content.querySelector('iframe')
          if (!iframe) {
            marker.remove()
            return restored
          }
          marker.replaceWith(iframe)
          return restored + 1
        }, 0)

        return restoredFromRecords + restoredFromMarkers
      },
      args: [chrome.runtime.id],
    })
    const totalRestored = results.reduce((sum, result) => sum + (result.result ?? 0), 0)
    if (totalRestored > 0) {
      logger.debug(`Restored ${totalRestored} restricted chrome-extension:// iframe(s) in tab:`, tabId)
    }
    return totalRestored
  } catch (e) {
    // The page may have navigated or closed while attachment was in flight. Its old DOM and
    // restricted frames no longer exist, so there is nothing left to restore in that case.
    logger.debug('Could not restore restricted iframes (expected after navigation/close):', (e as Error).message)
    return 0
  }
}

// Chrome accepts only one debugger lifecycle operation per tab at a time.
// Consecutive attach requests still share a promise, while an intervening detach
// forces the next attach to run as a new queued operation.
const tabDebuggerOperations = new TabDebuggerOperationQueue<AttachTabResult>()
const ATTACH_CDP_COMMAND_TIMEOUT_MS = 10000

async function attachTab(tabId: number, options: { skipAttachedEvent?: boolean } = {}): Promise<AttachTabResult> {
  return tabDebuggerOperations.attach(tabId, async () => {
    return await attachTabImpl(tabId, options)
  })
}

function detachDebugger(tabId: number): Promise<void> {
  return tabDebuggerOperations.detach(tabId, async () => {
    try {
      await chrome.debugger.detach({ tabId })
    } finally {
      await restoreRestrictedIframes(tabId)
    }
  })
}

async function attachTabImpl(
  tabId: number,
  { skipAttachedEvent = false }: { skipAttachedEvent?: boolean } = {},
): Promise<AttachTabResult> {
  const debuggee = { tabId }
  let debuggerAttached = false
  let attachCompleted = false

  try {
    logger.debug('Attaching debugger to tab:', tabId)

    // Bounded retry loop: chrome.debugger.attach fails if the tab contains chrome-extension://
    // iframes from other extensions. We remove them and retry, but aggressive extensions can
    // re-inject between cleanup and retry, so we allow up to 3 attempts.
    const maxAttachAttempts = 3
    for (let attempt = 1; attempt <= maxAttachAttempts; attempt++) {
      try {
        await chrome.debugger.attach(debuggee, '1.3')
        break
      } catch (attachError: any) {
        const msg = attachError.message ?? ''
        const isRestrictedIframeError = msg.includes('chrome-extension://') || msg.includes('different extension')
        if (!isRestrictedIframeError || attempt === maxAttachAttempts) {
          throw attachError
        }
        logger.debug(
          `Debugger attach blocked by chrome-extension:// iframe (attempt ${attempt}/${maxAttachAttempts}), removing and retrying:`,
          tabId,
        )
        await temporarilyRemoveRestrictedIframes(tabId)
        await sleep(50)
      }
    }

    debuggerAttached = true
    logger.debug('Debugger attached successfully to tab:', tabId)

    await sendCommandWithTimeout(debuggee, 'Page.enable', undefined, ATTACH_CDP_COMMAND_TIMEOUT_MS)

    // Reapply cached auto-attach for new tabs so OOPIF targets are reported immediately.
    if (autoAttachParams) {
      try {
        await sendCommandWithTimeout(debuggee, 'Target.setAutoAttach', autoAttachParams, ATTACH_CDP_COMMAND_TIMEOUT_MS)
      } catch (error) {
        logger.debug('Failed to apply auto-attach for tab:', tabId, error)
      }
    }

    const contextMenuScript = js`
      document.addEventListener('contextmenu', (e) => {
        window.__penguinBrowser_lastRightClicked = e.target;
      }, true);
    `
    await sendCommandWithTimeout(
      debuggee,
      'Page.addScriptToEvaluateOnNewDocument',
      { source: contextMenuScript },
      ATTACH_CDP_COMMAND_TIMEOUT_MS,
    )
    await sendCommandWithTimeout(
      debuggee,
      'Runtime.evaluate',
      { expression: contextMenuScript },
      ATTACH_CDP_COMMAND_TIMEOUT_MS,
    )

    // Ghost cursor — survives navigations via addScriptToEvaluateOnNewDocument.
    try {
      await sendCommandWithTimeout(
        debuggee,
        'Page.addScriptToEvaluateOnNewDocument',
        { source: ghostCursorBundleCode },
        ATTACH_CDP_COMMAND_TIMEOUT_MS,
      )
      await sendCommandWithTimeout(
        debuggee,
        'Runtime.evaluate',
        { expression: ghostCursorBundleCode },
        ATTACH_CDP_COMMAND_TIMEOUT_MS,
      )
    } catch (err) {
      logger.debug('Could not inject ghost cursor (restricted page):', (err as Error).message)
    }

    const result = (await sendCommandWithTimeout(
      debuggee,
      'Target.getTargetInfo',
      undefined,
      ATTACH_CDP_COMMAND_TIMEOUT_MS,
    )) as Protocol.Target.GetTargetInfoResponse

    const targetInfo = result.targetInfo

    // Log error if URL is empty - this causes Playwright to create broken pages
    if (!targetInfo.url || targetInfo.url === '' || targetInfo.url === ':') {
      logger.error(
        'WARNING: Target.attachedToTarget will be sent with empty URL! tabId:',
        tabId,
        'targetInfo:',
        JSON.stringify(targetInfo),
      )
    }

    const attachOrder = nextSessionId
    const sessionId = `pw-tab-${tabSessionScope}-${nextSessionId++}`

    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.set(tabId, {
        sessionId,
        targetId: targetInfo.targetId,
        state: 'connected',
        attachOrder,
      })
      return { tabs: newTabs, connectionState: 'connected', errorText: undefined }
    })

    if (!skipAttachedEvent) {
      sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId,
            targetInfo: { ...targetInfo, attached: true },
            waitingForDebugger: false,
          },
        },
      })
    }

    logger.debug(
      'Tab attached successfully:',
      tabId,
      'sessionId:',
      sessionId,
      'targetId:',
      targetInfo.targetId,
      'url:',
      targetInfo.url,
      'skipAttachedEvent:',
      skipAttachedEvent,
    )

    // Inject the in-page toolbar into the MAIN world (best-effort: silently
    // fails on restricted pages like chrome:// or about:blank)
    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: false },
        world: 'MAIN',
        func: initPenguinBrowserToolbar,
        args: [chrome.runtime.getURL('icons/penguin-browser-icon-black.png')],
      })
      .catch((err: Error) => {
        logger.debug('Could not inject toolbar (restricted page):', err.message)
      })

    attachCompleted = true
    return { targetInfo, sessionId }
  } catch (error) {
    // Clean up debugger if we attached but failed later
    if (debuggerAttached) {
      logger.debug('Cleaning up debugger after partial attach failure:', tabId)
      // This cleanup is already running inside the tab's serialized attach
      // operation. Await it directly so the next queued operation cannot start
      // before Chrome has finished detaching.
      try {
        await chrome.debugger.detach(debuggee)
      } catch {}
    }
    throw error
  } finally {
    // Restoring restricted frames while the debugger is attached makes Chrome detach again.
    // Keep successful attachments in inert placeholders until detach; every failed or partial
    // attach restores immediately after its debugger cleanup.
    if (!attachCompleted) {
      await restoreRestrictedIframes(tabId)
    }
  }
}

async function detachTab(tabId: number, shouldDetachDebugger: boolean): Promise<void> {
  const tab = store.getState().tabs.get(tabId)
  if (!tab) {
    logger.debug('detachTab: tab not found in map:', tabId)
    await restoreRestrictedIframes(tabId)
    return
  }

  // Clean up any active recording for this tab
  cleanupRecordingForTab(tabId)

  // Destroy the in-page toolbar (best-effort: tab may already be closing or navigating)
  void chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        ;(window as any).__penguinBrowserToolbarDestroy?.()
      },
    })
    .catch(() => {})

  void chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        ;(globalThis as any).__penguinBrowserGhostCursor?.disable?.()
      },
    })
    .catch(() => {})

  logger.warn(`DISCONNECT: detachTab tabId=${tabId} shouldDetach=${shouldDetachDebugger} stack=${getCallStack()}`)

  // Remove the visible state immediately so a fast second click expresses a
  // reconnect intent. The serialized detach below repeats this cleanup after
  // any earlier attach finishes, then a later attach can safely run.
  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    newTabs.delete(tabId)
    return { tabs: newTabs }
  })

  await tabDebuggerOperations.detach(tabId, async () => {
    // An attach that was already running when disconnect was requested may have
    // populated a newer session after the immediate state removal above.
    const attachedDuringDisconnect = store.getState().tabs.get(tabId)
    const tabToDetach = attachedDuringDisconnect?.sessionId ? attachedDuringDisconnect : tab

    if (tabToDetach.sessionId && tabToDetach.targetId) {
      sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: { sessionId: tabToDetach.sessionId, targetId: tabToDetach.targetId },
        },
      })
    }

    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.delete(tabId)
      return { tabs: newTabs }
    })
    emitChildDetachesForTab(tabId)

    if (shouldDetachDebugger) {
      try {
        await chrome.debugger.detach({ tabId })
      } catch (err) {
        logger.debug('Error detaching debugger from tab:', tabId, (err as Error).message)
      }
    }
    await restoreRestrictedIframes(tabId)
  })
}

async function connectTab(tabId: number): Promise<void> {
  try {
    logger.debug(`Starting connection to tab ${tabId}`)

    setTabConnecting(tabId)

    await connectionManager.ensureConnection()
    await attachTab(tabId)

    logger.debug(`Successfully connected to tab ${tabId}`)
  } catch (error: any) {
    logger.debug(`Failed to connect to tab ${tabId}:`, error)

    // Distinguish between WS connection errors and tab-specific errors
    // WS errors: keep in 'connecting' state, maintainLoop will retry when WS is available
    // Tab errors: show 'error' state (e.g., restricted page, debugger attach failed)
    // Extension in use: set global 'extension-replaced' state to enter polling mode
    const isExtensionInUse =
      error.message === 'Extension Already In Use' ||
      error.message === 'Another Travel Browser extension is already connected'

    const isWsError =
      error.message === 'Server not available' ||
      error.message === 'Connection timeout' ||
      error.message.startsWith('WebSocket')

    if (isExtensionInUse) {
      logger.debug(`Another extension is in use, entering polling mode`)
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        newTabs.delete(tabId)
        return {
          tabs: newTabs,
          connectionState: 'extension-replaced',
          errorText: 'Another Travel Browser extension is actively in use',
        }
      })
    } else if (isWsError) {
      logger.debug(`WS connection failed, keeping tab ${tabId} in connecting state for retry`)
      // Tab stays in 'connecting' state - maintainLoop will retry when WS becomes available
    } else {
      // If the tab was closed mid-attach, don't write an error entry —
      // onTabRemoved already deleted it and we'd leak a dead tabId.
      let tabStillExists = true
      try {
        await chrome.tabs.get(tabId)
      } catch {
        tabStillExists = false
      }
      if (!tabStillExists) {
        logger.debug(`Tab ${tabId} was closed during connect, dropping error state`)
        store.setState((state) => {
          const newTabs = new Map(state.tabs)
          newTabs.delete(tabId)
          return { tabs: newTabs }
        })
        return
      }
      if (!store.getState().tabs.has(tabId)) {
        logger.debug(`Tab ${tabId} was detached during connect, dropping error state`)
        return
      }
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        newTabs.set(tabId, { state: 'error', errorText: `Error: ${error.message}` })
        return { tabs: newTabs }
      })
    }
  }
}

function setTabConnecting(tabId: number): void {
  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    const existing = newTabs.get(tabId)
    newTabs.set(tabId, { ...existing, state: 'connecting' })
    return { tabs: newTabs }
  })
}

async function disconnectTab(tabId: number): Promise<void> {
  logger.debug(`Disconnecting tab ${tabId}`)

  const { tabs } = store.getState()
  if (!tabs.has(tabId)) {
    logger.debug('Tab not in tabs map, ignoring disconnect')
    await restoreRestrictedIframes(tabId)
    return
  }

  await detachTab(tabId, true)
  // WS connection is maintained even with no tabs - maintainConnection handles it
}

async function toggleExtensionForActiveTab(): Promise<{ isConnected: boolean; state: ExtensionState }> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) throw new Error('No active tab found')

  await onActionClicked(tab)

  await new Promise<void>((resolve) => {
    const check = () => {
      const state = store.getState()
      const tabInfo = state.tabs.get(tab.id!)
      if (tabInfo?.state === 'connecting') {
        setTimeout(check, 100)
        return
      }
      resolve()
    }
    check()
  })

  const state = store.getState()
  const isConnected = state.tabs.has(tab.id) && state.tabs.get(tab.id)?.state === 'connected'
  return { isConnected, state }
}

async function disconnectEverything(): Promise<void> {
  // Queue disconnect operation to serialize with other tab group operations
  tabGroupQueue = tabGroupQueue.then(async () => {
    const { tabs } = store.getState()
    for (const tabId of tabs.keys()) {
      await disconnectTab(tabId)
    }
  })
  await tabGroupQueue
  // WS connection is maintained - maintainConnection handles it
}

async function resetDebugger(): Promise<void> {
  let targets = await chrome.debugger.getTargets()
  targets = targets.filter((x) => x.tabId && x.attached)
  logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`)
  for (const target of targets) {
    await detachDebugger(target.tabId!)
  }
}

// Allow attaching to pages owned by this exact extension build.
const OUR_EXTENSION_IDS = [chrome.runtime.id]

// undefined URL is for about:blank pages (not restricted) and chrome:// URLs (restricted).
// We can't distinguish them without the `tabs` permission, so we just let attachment fail.
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false

  // Allow our own extension pages, block all other extensions
  if (url.startsWith('chrome-extension://')) {
    const extensionId = url.replace('chrome-extension://', '').split('/')[0]
    return !OUR_EXTENSION_IDS.includes(extensionId)
  }

  const restrictedPrefixes = [
    'chrome://',
    'devtools://',
    'edge://',
    'https://chrome.google.com/',
    'https://chromewebstore.google.com/',
  ]
  return restrictedPrefixes.some((prefix) => url.startsWith(prefix))
}

const icons = {
  connected: {
    path: {
      '16': '/icons/icon-green-16.png',
      '32': '/icons/icon-green-32.png',
      '48': '/icons/icon-green-48.png',
      '128': '/icons/icon-green-128.png',
    },
    title: 'Connected - Click to disconnect',
    badgeText: '',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  connecting: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Waiting for MCP WS server...',
    badgeText: '...',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  idle: {
    path: {
      '16': '/icons/icon-black-16.png',
      '32': '/icons/icon-black-32.png',
      '48': '/icons/icon-black-48.png',
      '128': '/icons/icon-black-128.png',
    },
    title: 'Click to attach debugger',
    badgeText: '',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  restricted: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Cannot attach to this page',
    badgeText: '',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  extensionReplaced: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Another Travel Browser extension connected - Click to retry',
    badgeText: '!',
    badgeColor: [220, 38, 38, 255] as [number, number, number, number],
  },
  tabError: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Error',
    badgeText: '!',
    badgeColor: [220, 38, 38, 255] as [number, number, number, number],
  },
} as const

function settleChromeApiCall(promise: Promise<unknown> | undefined, operation: string): void {
  if (!promise) return
  void promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    // Chrome rejects pending extension API calls while the browser/context is
    // closing. Consume that expected shutdown signal instead of reporting a
    // misleading unhandled rejection in the service worker.
    if (message.includes('browser is shutting down')) return
    logger.debug(`Chrome API call failed (${operation}):`, message)
  })
}

async function updateIcons(): Promise<void> {
  try {
    const state = store.getState()
    const { connectionState, tabs, errorText } = state

    const connectedCount = Array.from(tabs.values()).filter((t) => t.state === 'connected').length

    const allTabs = await chrome.tabs.query({})
    const tabUrlMap = new Map(allTabs.map((tab) => [tab.id, tab.url]))
    const allTabIds = [undefined, ...allTabs.map((tab) => tab.id).filter((id): id is number => id !== undefined)]

    for (const tabId of allTabIds) {
      const tabInfo = tabId !== undefined ? tabs.get(tabId) : undefined
      const tabUrl = tabId !== undefined ? tabUrlMap.get(tabId) : undefined

      const iconConfig = (() => {
        if (connectionState === 'extension-replaced') return icons.extensionReplaced
        if (tabId !== undefined && isRestrictedUrl(tabUrl)) return icons.restricted
        if (tabInfo?.state === 'error') return icons.tabError
        if (tabInfo?.state === 'connecting') return icons.connecting
        if (tabInfo?.state === 'connected') return icons.connected
        return icons.idle
      })()

      const title = (() => {
        if (connectionState === 'extension-replaced' && errorText) return errorText
        if (tabInfo?.errorText) return tabInfo.errorText
        return iconConfig.title
      })()

      const badgeText = (() => {
        if (iconConfig === icons.connected || iconConfig === icons.idle || iconConfig === icons.restricted) {
          return connectedCount > 0 ? String(connectedCount) : ''
        }
        return iconConfig.badgeText
      })()

      settleChromeApiCall(chrome.action.setIcon({ tabId, path: iconConfig.path }), 'setIcon')
      settleChromeApiCall(chrome.action.setTitle({ tabId, title }), 'setTitle')
      if (iconConfig.badgeColor) {
        settleChromeApiCall(
          chrome.action.setBadgeBackgroundColor({ tabId, color: iconConfig.badgeColor }),
          'setBadgeBackgroundColor',
        )
      }
      settleChromeApiCall(chrome.action.setBadgeText({ tabId, text: badgeText }), 'setBadgeText')
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('browser is shutting down')) {
      logger.debug('Failed to update extension icons:', message)
    }
  }
}

async function onTabRemoved(tabId: number): Promise<void> {
  popupSourceTabMap.delete(tabId)
  const { tabs } = store.getState()
  if (!tabs.has(tabId)) return
  logger.debug(`Connected tab ${tabId} was closed, disconnecting`)
  await disconnectTab(tabId)
}

async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  store.setState({ currentTabId: activeInfo.tabId, preferredWindowId: activeInfo.windowId })
}

async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) {
    logger.debug('No tab ID available')
    return
  }

  if (tab.windowId !== undefined) {
    store.setState({ currentTabId: tab.id, preferredWindowId: tab.windowId })
  }

  if (isRestrictedUrl(tab.url)) {
    logger.debug('Cannot attach to restricted URL:', tab.url)
    return
  }

  const { tabs, connectionState } = store.getState()
  const tabInfo = tabs.get(tab.id)

  // If another Travel Browser extension took over, clear error state and try to reconnect this tab
  if (connectionState === 'extension-replaced') {
    logger.debug('Clearing extension-replaced state, attempting to reconnect')
    store.setState({ connectionState: 'idle', errorText: undefined })
    await connectTab(tab.id)
    return
  }

  if (tabInfo?.state === 'error') {
    logger.debug('Tab has error - disconnecting to clear state')
    await disconnectTab(tab.id)
    return
  }

  if (tabInfo?.state === 'connecting') {
    logger.debug('Tab is already connecting, ignoring click')
    return
  }

  if (tabInfo?.state === 'connected') {
    await disconnectTab(tab.id)
  } else {
    await connectTab(tab.id)
  }
}

void resetDebugger()
  .catch((error) => {
    logger.debug('Failed to reset existing debugger targets:', (error as Error).message)
  })
  .finally(() => {
    void connectionManager.maintainLoop()
  })

chrome.contextMenus
  .remove('penguin-browser-pin-element')
  .catch(() => {})
  .finally(() => {
    chrome.contextMenus?.create({
      id: 'penguin-browser-pin-element',
      title: 'Copy Travel Browser Element Reference',
      contexts: ['all'],
      visible: false,
    })
  })

chrome.contextMenus
  .remove('penguin-browser-copy-react-source')
  .catch(() => {})
  .finally(() => {
    chrome.contextMenus?.create({
      id: 'penguin-browser-copy-react-source',
      title: 'Copy React Component Source Path',
      contexts: ['all'],
      visible: false,
    })
  })

function updateContextMenuVisibility(): void {
  const { currentTabId, tabs } = store.getState()
  const isConnected = currentTabId !== undefined && tabs.get(currentTabId)?.state === 'connected'
  settleChromeApiCall(
    chrome.contextMenus?.update('penguin-browser-pin-element', { visible: isConnected }),
    'update pin context menu',
  )
  settleChromeApiCall(
    chrome.contextMenus?.update('penguin-browser-copy-react-source', { visible: isConnected }),
    'update React context menu',
  )
}

function buildPinnedElementInspectionCode(options: { pinName: string; url: string }): string {
  const URL_LIT = JSON.stringify(options.url).replace(/'/g, '\\u0027')
  return `inspectPinnedElement(${URL_LIT},"globalThis.${options.pinName}")`
}

chrome.runtime.onInstalled.addListener((details) => {
  if (import.meta.env.TESTING) return
  if (!__PENGUIN_BROWSER_OPEN_WELCOME_PAGE__) return
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: 'src/welcome.html' })
  }
})

function serializeTabs(tabs: Map<number, TabInfo>): string {
  return JSON.stringify(Array.from(tabs.entries()))
}

store.subscribe((state, prevState) => {
  logger.log(state)
  void updateIcons()
  updateContextMenuVisibility()
  const tabsChanged = serializeTabs(state.tabs) !== serializeTabs(prevState.tabs)
  if (tabsChanged) {
    tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
      logger.debug('syncTabGroup error:', e)
    })
  }
})

logger.debug('Travel Browser connection discovery ready')

// Memory monitoring - helps debug service worker termination issues
let lastMemoryUsage = 0
let lastMemoryCheck = Date.now()
const MEMORY_WARNING_THRESHOLD = 50 * 1024 * 1024 // 50MB
const MEMORY_CRITICAL_THRESHOLD = 100 * 1024 * 1024 // 100MB
const MEMORY_GROWTH_THRESHOLD = 10 * 1024 * 1024 // 10MB growth per interval is suspicious

function checkMemory(): void {
  try {
    // @ts-ignore - performance.memory is Chrome-specific and not in TS types
    const memory = performance.memory
    if (!memory) {
      return
    }

    const used = memory.usedJSHeapSize
    const total = memory.totalJSHeapSize
    const limit = memory.jsHeapSizeLimit
    const now = Date.now()
    const timeDelta = now - lastMemoryCheck
    const memoryDelta = used - lastMemoryUsage

    const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + 'MB'
    const growthRate = timeDelta > 0 ? (memoryDelta / timeDelta) * 1000 : 0 // bytes per second

    // Log if memory is high or growing rapidly
    if (used > MEMORY_CRITICAL_THRESHOLD) {
      logger.error(
        `MEMORY CRITICAL: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`,
      )
    } else if (used > MEMORY_WARNING_THRESHOLD) {
      logger.warn(
        `MEMORY WARNING: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`,
      )
    } else if (memoryDelta > MEMORY_GROWTH_THRESHOLD && timeDelta < 60000) {
      logger.warn(
        `MEMORY SPIKE: grew ${formatMB(memoryDelta)} in ${(timeDelta / 1000).toFixed(1)}s (used=${formatMB(used)})`,
      )
    }

    lastMemoryUsage = used
    lastMemoryCheck = now
  } catch (e) {
    // Silently ignore - performance.memory may not be available
  }
}

// Check memory every 5 seconds
setInterval(checkMemory, 5000)

// Initial memory check
checkMemory()

chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.action.onClicked.addListener(onActionClicked)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void updateIcons()
  if (changeInfo.groupId !== undefined) {
    // Queue tab group operations to serialize with syncTabGroup and disconnectEverything
    tabGroupQueue = tabGroupQueue
      .then(async () => {
        // The callback can sit behind an in-flight sync, so read the current tab
        // instead of acting on a stale event snapshot.
        let currentTab: chrome.tabs.Tab
        try {
          currentTab = await chrome.tabs.get(tabId)
        } catch {
          return
        }

        const ownedGroups = await getOwnedTabGroups()
        const ownedGroupId = ownedGroups.get(currentTab.windowId)
        if (ownedGroupId === undefined) return

        const { tabs } = store.getState()
        if (currentTab.groupId === ownedGroupId) {
          // Before treating a group membership change as authorization, verify
          // that the persisted ID still names our group in this window.
          const validatedGroupId = await getValidatedOwnedTabGroupId(currentTab.windowId)
          if (validatedGroupId === undefined) return
          if (!tabs.has(tabId) && !isRestrictedUrl(currentTab.url)) {
            logger.debug('Tab manually added to owned Travel Browser group:', tabId)
            await connectTab(tabId)
          }
        } else if (tabs.has(tabId)) {
          const tabInfo = tabs.get(tabId)
          if (tabInfo?.state === 'connecting') {
            logger.debug('Tab removed from group while connecting, ignoring:', tabId)
            return
          }
          logger.debug('Tab manually removed from owned Travel Browser group:', tabId)
          await disconnectTab(tabId)
        }
      })
      .catch((e) => {
        logger.debug('onTabUpdated handler error:', e)
      })
  }
})

// Track every new tab's source (opener) tab via webNavigation.
// chrome.tabs.Tab.openerTabId is unreliable for window.open popups — on
// Chromium 145 it is left null. onCreatedNavigationTarget gives a reliable
// source_tab_id → new_tab_id mapping for every window.open / target=_blank
// / cmd+click. Entries expire after 10s to cap memory for plain-new-tab
// cases that never trigger windows.onCreated.
const popupSourceTabMap = new Map<number, number>()

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  popupSourceTabMap.set(details.tabId, details.sourceTabId)
  setTimeout(() => {
    popupSourceTabMap.delete(details.tabId)
  }, 10000)

  // A regular target=_blank/window.open without popup features creates a tab
  // in the existing normal window, so windows.onCreated never fires. Treat a
  // child of an explicitly connected tab as authorized and attach it here.
  // Popup windows are left for the relocation handler below.
  void (async () => {
    if (!store.getState().tabs.has(details.sourceTabId)) return

    try {
      // Let Chrome finish assigning the target to its final window before
      // checking whether the relocation path owns it.
      await sleep(50)
      const tab = await chrome.tabs.get(details.tabId)
      const targetWindow = await chrome.windows.get(tab.windowId, { populate: false })
      if (targetWindow.type === 'popup') return
      if (isRestrictedUrl(details.url || tab.url)) return
      if (store.getState().tabs.has(details.tabId)) return

      logger.debug(`Auto-connecting child tab ${details.tabId} opened by connected tab ${details.sourceTabId}`)
      await connectTab(details.tabId)
      popupSourceTabMap.delete(details.tabId)
    } catch (error) {
      logger.warn(`Failed to auto-connect child tab ${details.tabId}:`, error)
    }
  })()
})

// Relocate popup windows opened by a Travel Browser-connected tab into the
// source tab's window as a regular tab, since Travel Browser cannot attach
// its debugger to separate popup windows. When the source tab is NOT
// connected, leave the popup alone so unrelated sites keep normal Chrome
// popup behavior. After relocation, auto-attach Travel Browser to the new
// tab so it appears in context.pages().
chrome.windows.onCreated.addListener(async (popupWindow) => {
  if (popupWindow.type !== 'popup' || popupWindow.id === undefined) {
    return
  }
  try {
    // Retry tab discovery — windows.onCreated can fire before
    // chrome.tabs.query({ windowId }) sees the new popup tab.
    let popupTabs: chrome.tabs.Tab[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      popupTabs = await chrome.tabs.query({ windowId: popupWindow.id })
      if (popupTabs.length > 0) break
      await sleep(20)
    }
    const tabIds = popupTabs
      .map((t) => t.id)
      .filter((id): id is number => {
        return id !== undefined
      })
    if (tabIds.length === 0) {
      logger.debug(`Popup window ${popupWindow.id} has no tabs after retry, skipping`)
      return
    }

    const { tabs: connectedTabs } = store.getState()
    let sourceTabId: number | undefined
    for (const tabId of tabIds) {
      const candidate = popupSourceTabMap.get(tabId)
      if (candidate !== undefined && connectedTabs.has(candidate)) {
        sourceTabId = candidate
        break
      }
    }
    for (const tabId of tabIds) {
      popupSourceTabMap.delete(tabId)
    }
    if (sourceTabId === undefined) {
      logger.debug(
        `Popup window ${popupWindow.id} not opened by a Travel Browser-connected tab, leaving alone (tabs=${JSON.stringify(tabIds)})`,
      )
      return
    }

    let destinationWindowId: number
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId)
      if (sourceTab.windowId === undefined) {
        const focused = await chrome.windows.getLastFocused({ populate: false })
        if (focused.id === undefined || focused.id === popupWindow.id) {
          return
        }
        destinationWindowId = focused.id
      } else {
        destinationWindowId = sourceTab.windowId
      }
    } catch (e) {
      logger.debug(`Source tab ${sourceTabId} no longer exists, skipping relocation:`, e)
      return
    }

    logger.debug(
      `Relocating ${tabIds.length} popup tab(s) from window ${popupWindow.id} into source window ${destinationWindowId} (sourceTabId=${sourceTabId})`,
    )
    await chrome.tabs.move(tabIds, { windowId: destinationWindowId, index: -1 })
    try {
      await chrome.windows.remove(popupWindow.id)
    } catch {
      // Chrome may have already closed the empty popup window.
    }
    for (const tabId of tabIds) {
      if (connectedTabs.has(tabId)) continue
      try {
        await connectTab(tabId)
      } catch (e) {
        logger.warn(`Failed to auto-connect relocated popup tab ${tabId}:`, e)
      }
    }
  } catch (e) {
    logger.warn('Failed to relocate popup window:', e)
  }
})

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  const tabInfo = store.getState().tabs.get(tab.id)
  if (!tabInfo || tabInfo.state !== 'connected') {
    logger.debug('Tab not connected, ignoring')
    return
  }

  const debuggee = { tabId: tab.id }

  if (info.menuItemId === 'penguin-browser-pin-element') {
    try {
      // Allocate the next pin name by reading and incrementing the shared MAIN-world
      // counter (window.__penguinBrowserPinCount). This ensures right-click and toolbar
      // pins never produce conflicting globalThis.penguinBrowserPinnedElemN names.
      const jsAllocatePin = js`
        (function() {
          window.__penguinBrowserPinCount = (window.__penguinBrowserPinCount || 0) + 1;
          return window.__penguinBrowserPinCount;
        })()
      `
      const counterResult = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsAllocatePin,
        returnByValue: true,
      })) as { result?: { value?: number }; exceptionDetails?: { text: string } }

      const count = counterResult.result?.value ?? 1
      const name = `penguinBrowserPinnedElem${count}`

      const jsAssignPin = js`
        if (window.__penguinBrowser_lastRightClicked) {
          window.${name} = window.__penguinBrowser_lastRightClicked;
          '${name}';
        } else {
          throw new Error('No element was right-clicked');
        }
      `
      const result = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsAssignPin,
        returnByValue: true,
      })) as { result?: { value?: string }; exceptionDetails?: { text: string } }

      if (result.exceptionDetails) {
        logger.error('Failed to pin element:', result.exceptionDetails.text)
        return
      }

      const code = buildPinnedElementInspectionCode({ pinName: name, url: tab.url || '' })
      const clipboardText = "penguin-browser -e '" + code + "'"

      const jsPinFlashAndCopy = js`
        (() => {
          const el = window.${name};
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `
      await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsPinFlashAndCopy,
        awaitPromise: true,
        userGesture: true,
      })

      logger.debug('Pinned element as:', name)
    } catch (error: any) {
      logger.error('Failed to pin element:', error.message)
    }
  }

  if (info.menuItemId === 'penguin-browser-copy-react-source') {
    try {
      // Inject bippy (React fiber introspection) if not already present.
      // bippy exposes globalThis.__bippy with methods to walk the React fiber tree
      // and resolve source file locations from React DevTools metadata.
      const hasBippy = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: '!!globalThis.__bippy',
        returnByValue: true,
      })) as { result?: { value?: boolean } }

      if (!hasBippy.result?.value) {
        await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
          expression: bippyBundleCode,
        })
      }

      // Walk from the right-clicked DOM element up through React fiber tree to find
      // the nearest composite component with source location info. Uses bippy's
      // getSource() first (direct __source prop from JSX transform), then falls back
      // to getOwnerStack() for production builds with source maps.
      const jsResolveSource = js`
        (async () => {
          const el = window.__penguinBrowser_lastRightClicked;
          if (!el) return JSON.stringify({ error: 'No element was right-clicked' });

          const bippy = globalThis.__bippy;
          if (!bippy) return JSON.stringify({ error: 'bippy not loaded' });

          // bippy.normalizeFileName strips "/app-pages-browser/" but not the parenthesized
          // form "/(app-pages-browser)/" that Next.js webpack actually uses. This regex
          // strips all Next.js webpack layer prefixes: (app-pages-browser), (ssr), (rsc),
          // (action-browser), (pages-dir-browser), (pages-dir-edge), (pages-dir-node).
          // Also strips leading "./" that often follows the layer prefix.
          const cleanFileName = (name) => {
            let f = bippy.normalizeFileName(name);
            f = f.replace(/^\/?\\([-\\w]+\\)\\//, '');
            f = f.replace(/^\\.[\\/]/, '');
            return f;
          };

          let fiber;
          try { fiber = bippy.getFiberFromHostInstance(el); } catch {}
          if (!fiber) return JSON.stringify({ error: 'No React fiber found. Is this a React app?' });

          // Walk up to find nearest composite fiber with source info
          let current = fiber;
          for (let i = 0; i < 50 && current; i++) {
            try {
              if (bippy.isCompositeFiber(current)) {
                const source = await bippy.getSource(current);
                if (source && source.fileName && bippy.isSourceFile(source.fileName)) {
                  return JSON.stringify({
                    fileName: cleanFileName(source.fileName),
                    lineNumber: source.lineNumber || null,
                    columnNumber: source.columnNumber || null,
                    componentName: source.functionName || bippy.getDisplayName(current.type) || null,
                  });
                }
                // Try owner stack as fallback for this fiber
                const ownerStack = await bippy.getOwnerStack(current);
                for (const frame of ownerStack) {
                  if (frame.fileName && bippy.isSourceFile(frame.fileName)) {
                    return JSON.stringify({
                      fileName: cleanFileName(frame.fileName),
                      lineNumber: frame.lineNumber || null,
                      columnNumber: frame.columnNumber || null,
                      componentName: frame.functionName || bippy.getDisplayName(current.type) || null,
                    });
                  }
                }
              }
            } catch {}
            current = current.return;
          }
          return JSON.stringify({ error: 'No React source location found. Is this a dev build with source maps?' });
        })()
      `
      const sourceResult = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsResolveSource,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: string }; exceptionDetails?: { text: string } }

      if (sourceResult.exceptionDetails) {
        logger.error('Failed to get React source:', sourceResult.exceptionDetails.text)
        return
      }

      const parsed = JSON.parse(sourceResult.result?.value || '{}')

      if (!parsed.fileName && !parsed.error) {
        parsed.error = 'React source result missing fileName'
      }

      if (parsed.error) {
        // Flash red outline on the element to indicate no React source found
        const jsFlashRed = js`
          (() => {
            const el = window.__penguinBrowser_lastRightClicked;
            if (!el) return;
            const orig = el.getAttribute('style') || '';
            el.setAttribute('style', orig + '; outline: 3px solid #ef4444 !important; outline-offset: 2px !important;');
            setTimeout(() => el.setAttribute('style', orig), 600);
          })()
        `
        await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
          expression: jsFlashRed,
        })
        logger.debug('React source not found:', parsed.error)
        return
      }

      // Build clipboard text: "path/to/file.tsx:42" or "path/to/file.tsx" if no line
      const clipboardText: string = (() => {
        if (parsed.lineNumber) {
          return `${parsed.fileName}:${parsed.lineNumber}`
        }
        return parsed.fileName
      })()

      // Flash green outline and copy to clipboard
      const jsFlashGreenAndCopy = js`
        (() => {
          const el = window.__penguinBrowser_lastRightClicked;
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `
      await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsFlashGreenAndCopy,
        awaitPromise: true,
        userGesture: true,
      })

      logger.debug('Copied React source path:', clipboardText, 'component:', parsed.componentName)
    } catch (error: any) {
      logger.error('Failed to copy React source:', error.message)
    }
  }
})

// Sync icons on first load
void updateIcons()

// Only the extension's own settings page can inspect or change its pairing.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('src/connection.html'))) return
  if (message.action !== 'connectionStatus' && message.action !== 'connectionChoose') return
  void (async () => {
    if (message.action === 'connectionChoose') {
      const choice = message.choice as ConnectionChoice
      if (choice?.mode !== 'standalone' && !(choice?.mode === 'desktop' && /^[a-f0-9]{32}$/.test(choice.installationId ?? ''))) {
        throw new Error('Invalid application selection')
      }
      if (choice.mode === 'desktop') {
        const apps = await availableDesktops()
        if (!apps.some(app => app.installationId === choice.installationId)) throw new Error('That application is no longer running')
      }
      await connectionManager.setChoice(choice)
    }
    let apps: Awaited<ReturnType<typeof availableDesktops>> = []
    let discoveryError: string | undefined
    try { apps = await availableDesktops() } catch (error) { discoveryError = (error as Error).message }
    const endpoint = connectionManager.endpoint
    return { choice: await readConnectionChoice(), apps, discoveryError,
      connected: connectionManager.ws?.readyState === WebSocket.OPEN,
      application: endpoint?.desktop?.name,
      error: store.getState().errorText }
  })().then(sendResponse, error => sendResponse({ error: error.message }))
  return true
})

// Handle messages from offscreen document (recording chunks)
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'recordingChunk') {
    const { tabId, data, final } = message

    if (connectionManager.ws?.readyState === WebSocket.OPEN) {
      abortedBufferedRecordings.delete(tabId)
      // Send metadata message first
      sendMessage({
        method: 'recordingData',
        params: { tabId, final },
      })

      // Then send binary data if not final
      if (data && !final) {
        const buffer = new Uint8Array(data)
        connectionManager.ws.send(buffer)
      }
    } else {
      // Buffer chunks when WebSocket isn't ready - they'll be flushed when it opens.
      // This prevents data loss during brief disconnections or slow WebSocket startup.
      if (abortedBufferedRecordings.has(tabId)) return false

      const chunkBytes = Array.isArray(data) ? data.length : 0
      if (recordingChunkBufferBytes + chunkBytes > MAX_RECORDING_CHUNK_BUFFER_BYTES) {
        logger.error(
          `Recording buffer exceeded ${MAX_RECORDING_CHUNK_BUFFER_BYTES} bytes for tab ${tabId}; cancelling recording`,
        )
        abortedBufferedRecordings.add(tabId)
        removeBufferedRecordingChunks(tabId)
        void cleanupRecordingForTab(tabId)
        return false
      }

      logger.debug(`Buffering recording chunk for tab ${tabId} (WebSocket not ready)`)
      recordingChunkBuffer.push({ tabId, data, final })
      recordingChunkBufferBytes += chunkBytes
    }

    return false // Sync response, no need to keep channel open
  }

  if (message.action === 'recordingCancelled') {
    const { tabId } = message

    getActiveRecordings().delete(tabId)
    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      const existing = newTabs.get(tabId)
      if (existing) {
        newTabs.set(tabId, { ...existing, isRecording: false })
      }
      return { tabs: newTabs }
    })

    if (connectionManager.ws?.readyState === WebSocket.OPEN) {
      sendMessage({
        method: 'recordingCancelled',
        params: { tabId },
      })
      abortedBufferedRecordings.delete(tabId)
    } else {
      removeBufferedRecordingChunks(tabId)
      if (!recordingChunkBuffer.some((chunk) => chunk.tabId === tabId && chunk.cancelled)) {
        recordingChunkBuffer.push({ tabId, cancelled: true })
      }
    }

    return false
  }

  return false
})

// Re-inject the toolbar after hard navigations in connected tabs.
// The MAIN-world script is destroyed on every full page load, so we re-run
// initPenguinBrowserToolbar once the new document's DOM is ready.
// onDOMContentLoaded is used instead of onCommitted because executeScript
// with world:'MAIN' needs the document to exist before injecting.
// Note: SPA route changes (pushState/replaceState) don't trigger this because
// the document is not reset — the toolbar DOM persists across SPA navigations.
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  if (details.frameId !== 0) return // top frame only
  const { tabs } = store.getState()
  const tabInfo = tabs.get(details.tabId)
  if (!tabInfo || tabInfo.state !== 'connected') return

  chrome.scripting
    .executeScript({
      target: { tabId: details.tabId, allFrames: false },
      world: 'MAIN',
      func: initPenguinBrowserToolbar,
      args: [chrome.runtime.getURL('icons/penguin-browser-icon-black.png')],
    })
    .catch((err: Error) => {
      logger.debug('Could not re-inject toolbar after navigation:', err.message)
    })
})
