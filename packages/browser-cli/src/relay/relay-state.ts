/**
 * Centralized relay state: one immutable atom for domain state + runtime resources.
 *
 * Follows the zustand-centralized-state skill pattern:
 * - Single Zustand vanilla store holds all relay state
 * - setState() callbacks remain deterministic data transitions
 * - Runtime resources (WebSocket/timers/pending callbacks) are co-located on
 *   each extension entry in the same map
 *
 * See docs/decisions/implemented/2026-08-12-centralize-relay-state.md (repo root) for the
 * decision record: rationale, alternatives, and the deviations from the original plan.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { WSContext } from 'hono/ws'
import type { Protocol } from './cdp-types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectedTarget = {
  sessionId: string
  targetId: string
  targetInfo: Protocol.Target.TargetInfo
  frameIds: Set<string>
}

export type ExtensionInfo = {
  browser?: string
  email?: string
  id?: string
  installId?: string
  /** penguin-browser package version the extension was built with (sent as ?v= query param) */
  version?: string
}

export type ExtensionPendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

/**
 * Single aggregated extension object: domain state + runtime I/O.
 */
export type ExtensionEntry = {
  id: string
  info: ExtensionInfo
  stableKey: string
  connectedTargets: Map<string, ConnectedTarget>
  // Runtime I/O fields
  ws: WSContext | null
  pendingRequests: Map<number, ExtensionPendingRequest>
  messageId: number
  pingInterval: ReturnType<typeof setInterval> | null
}

export type PlaywrightClient = {
  id: string
  extensionId: string | null
  ws: WSContext
  /** Targets already announced to this client, keyed by targetId. */
  attachedTargets: Map<string, string>
  /**
   * The conversation this client is working in, for in-app browser sessions.
   *
   * One desktop shell serves every conversation through a single backend connection, so without
   * this a client would be shown every conversation's targets — their URLs and titles included,
   * before any ownership check has a chance to refuse a command. Absent for extension and direct
   * backends, where there is no such thing as a conversation.
   */
  iabSession?: string
  /** The task this client is driving, for in-app browser sessions. */
  iabTask?: string
}

export type RelayState = {
  extensions: Map<string, ExtensionEntry>
  playwrightClients: Map<string, PlaywrightClient>
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createRelayStore(): StoreApi<RelayState> {
  return createStore<RelayState>(() => ({
    extensions: new Map(),
    playwrightClients: new Map(),
  }))
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

/**
 * Linear scan over extensions to find one by stableKey. With <10 extensions this is free.
 * Returns the LAST (newest) match because during reconnect both old and new connections
 * coexist briefly. Map iteration order is insertion order, so last wins.
 */
export function findExtensionByStableKey(state: RelayState, stableKey: string): ExtensionEntry | undefined {
  let match: ExtensionEntry | undefined
  for (const ext of state.extensions.values()) {
    if (ext.stableKey === stableKey) {
      match = ext
    }
  }
  return match
}

export function hasPersistentExtensionIdentity(info: ExtensionInfo): boolean {
  return Boolean(info.installId)
}

export function buildStableExtensionKey(info: ExtensionInfo, connectionId: string): string {
  // chrome.identity ids/emails identify an account, not one Chrome profile or
  // extension installation. Only the per-install storage id is safe for a
  // reconnectable session binding. Older extensions remain connection-scoped
  // until upgraded instead of silently taking over another installation's session.
  if (info.installId) {
    return `install:${info.installId}`
  }
  return `connection:${connectionId}`
}

/** Find which extension owns a CDP tab sessionId (e.g. "pw-tab-1"). */
export function findExtensionIdByCdpSession(state: RelayState, cdpSessionId: string): string | null {
  for (const [connectionId, ext] of state.extensions.entries()) {
    if (ext.connectedTargets.has(cdpSessionId)) {
      return connectionId
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Pure state transition functions
//
// Each takes RelayState + event data and returns a new RelayState.
// No I/O, no side effects. Testable with data in / data out.
// ---------------------------------------------------------------------------

/**
 * Add a new extension connection.
 * Does NOT remove an existing connection with the same stableKey — that old
 * connection stays routable until its WebSocket onClose fires and calls
 * removeExtension(). This preserves in-flight message routing during reconnect.
 * findExtensionByStableKey() returns the newest match so stableKey lookups
 * resolve to the new connection immediately.
 */
export function addExtension(
  state: RelayState,
  {
    id,
    info,
    stableKey,
    ws,
  }: {
    id: string
    info: ExtensionInfo
    stableKey: string
    ws: WSContext | null
  },
): RelayState {
  const newExtensions = new Map(state.extensions)

  newExtensions.set(id, {
    id,
    info,
    stableKey,
    connectedTargets: new Map(),
    ws,
    pendingRequests: new Map(),
    messageId: 0,
    pingInterval: null,
  })
  return { ...state, extensions: newExtensions }
}

/** Remove an extension, its targets, and (normally) any Playwright clients bound to it. */
export function removeExtension(
  state: RelayState,
  {
    extensionId,
    preservePlaywrightClients = false,
  }: { extensionId: string; preservePlaywrightClients?: boolean },
): RelayState {
  if (!state.extensions.has(extensionId)) {
    return state
  }
  const newExtensions = new Map(state.extensions)
  newExtensions.delete(extensionId)

  if (preservePlaywrightClients) {
    return { ...state, extensions: newExtensions }
  }

  // Also remove playwright clients bound to the extension
  const clientsToRemove = Array.from(state.playwrightClients.values()).filter(
    (client) => client.extensionId === extensionId,
  )
  if (clientsToRemove.length === 0) {
    return { ...state, extensions: newExtensions }
  }

  const newClients = new Map(state.playwrightClients)
  for (const client of clientsToRemove) {
    newClients.delete(client.id)
  }
  return { ...state, extensions: newExtensions, playwrightClients: newClients }
}

/** Add a playwright client (state + ws handle co-located). */
export function addPlaywrightClient(
  state: RelayState,
  {
    id,
    extensionId,
    ws,
    iabSession,
    iabTask,
  }: {
    id: string
    extensionId: string | null
    ws: WSContext
    /** The conversation this client works in; absent for extension and direct backends. */
    iabSession?: string
    /** The task it drives; absent for extension and direct backends. */
    iabTask?: string
  },
): RelayState {
  const newClients = new Map(state.playwrightClients)
  newClients.set(id, {
    id,
    extensionId,
    ws,
    attachedTargets: new Map(),
    ...(iabSession ? { iabSession } : {}),
    ...(iabTask ? { iabTask } : {}),
  })
  return { ...state, playwrightClients: newClients }
}

/** Remove a playwright client. */
export function removePlaywrightClient(state: RelayState, { clientId }: { clientId: string }): RelayState {
  if (!state.playwrightClients.has(clientId)) {
    return state
  }
  const newClients = new Map(state.playwrightClients)
  newClients.delete(clientId)
  return { ...state, playwrightClients: newClients }
}

/** Rebind all clients from one extension id to another. */
export function rebindClientsToExtension(
  state: RelayState,
  { fromExtensionId, toExtensionId }: { fromExtensionId: string; toExtensionId: string },
): RelayState {
  if (fromExtensionId === toExtensionId) {
    return state
  }

  let updated = false
  const newClients = new Map(state.playwrightClients)
  for (const [clientId, client] of newClients) {
    if (client.extensionId !== fromExtensionId) {
      continue
    }
    newClients.set(clientId, { ...client, extensionId: toExtensionId })
    updated = true
  }

  if (!updated) {
    return state
  }

  return { ...state, playwrightClients: newClients }
}

/** Update an extension entry's I/O fields (ws, pingInterval). */
export function updateExtensionIO(
  state: RelayState,
  {
    extensionId,
    ws,
    pingInterval,
  }: {
    extensionId: string
    ws?: WSContext | null
    pingInterval?: ReturnType<typeof setInterval> | null
  },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }
  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, {
    ...ext,
    ...(ws !== undefined ? { ws } : {}),
    ...(pingInterval !== undefined ? { pingInterval } : {}),
  })
  return { ...state, extensions: newExtensions }
}

/** Add or replace one pending extension request callback pair. */
export function addExtensionPendingRequest(
  state: RelayState,
  {
    extensionId,
    requestId,
    pendingRequest,
  }: {
    extensionId: string
    requestId: number
    pendingRequest: ExtensionPendingRequest
  },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }

  const pendingRequests = new Map(ext.pendingRequests)
  pendingRequests.set(requestId, pendingRequest)
  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, pendingRequests })
  return { ...state, extensions: newExtensions }
}

/** Remove one pending extension request callback pair. */
export function removeExtensionPendingRequest(
  state: RelayState,
  { extensionId, requestId }: { extensionId: string; requestId: number },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext || !ext.pendingRequests.has(requestId)) {
    return state
  }

  const pendingRequests = new Map(ext.pendingRequests)
  pendingRequests.delete(requestId)
  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, pendingRequests })
  return { ...state, extensions: newExtensions }
}

/** Add a target to an extension's connectedTargets. No-op if extension doesn't exist. */
export function addTarget(
  state: RelayState,
  {
    extensionId,
    sessionId,
    targetId,
    targetInfo,
    existingFrameIds,
  }: {
    extensionId: string
    sessionId: string
    targetId: string
    targetInfo: Protocol.Target.TargetInfo
    /** Preserve existing frameIds if target already existed (update scenario). */
    existingFrameIds?: Set<string>
  },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }

  const existingTarget = ext.connectedTargets.get(sessionId)
  const newTargets = new Map(ext.connectedTargets)
  newTargets.set(sessionId, {
    sessionId,
    targetId,
    targetInfo,
    frameIds: existingFrameIds ?? existingTarget?.frameIds ?? new Set(),
  })

  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
  return { ...state, extensions: newExtensions }
}

/** Remove a target by sessionId. No-op if extension or target doesn't exist. */
export function removeTarget(
  state: RelayState,
  { extensionId, sessionId }: { extensionId: string; sessionId: string },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext || !ext.connectedTargets.has(sessionId)) {
    return state
  }

  const newTargets = new Map(ext.connectedTargets)
  newTargets.delete(sessionId)

  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
  return { ...state, extensions: newExtensions }
}

/** Remove a crashed target by targetId (not sessionId). */
export function removeTargetByCrash(
  state: RelayState,
  { extensionId, targetId }: { extensionId: string; targetId: string },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }

  let found = false
  const newTargets = new Map(ext.connectedTargets)
  for (const [sid, target] of newTargets) {
    if (target.targetId === targetId) {
      newTargets.delete(sid)
      found = true
      break
    }
  }

  if (!found) {
    return state
  }

  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
  return { ...state, extensions: newExtensions }
}

/** Update targetInfo on a target matched by targetId. */
export function updateTargetInfo(
  state: RelayState,
  { extensionId, targetInfo }: { extensionId: string; targetInfo: Protocol.Target.TargetInfo },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }

  let updated = false
  const newTargets = new Map(ext.connectedTargets)
  for (const [sid, target] of newTargets) {
    if (target.targetId === targetInfo.targetId) {
      newTargets.set(sid, { ...target, targetInfo })
      updated = true
      break
    }
  }

  if (!updated) {
    return state
  }

  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
  return { ...state, extensions: newExtensions }
}

/** Add a frameId to a target's frameIds set. */
export function addFrameId(
  state: RelayState,
  { extensionId, sessionId, frameId }: { extensionId: string; sessionId: string; frameId: string },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }
  const target = ext.connectedTargets.get(sessionId)
  if (!target) {
    return state
  }

  // Already present — no-op
  if (target.frameIds.has(frameId)) {
    return state
  }

  const newFrameIds = new Set(target.frameIds)
  newFrameIds.add(frameId)

  const newTargets = new Map(ext.connectedTargets)
  newTargets.set(sessionId, { ...target, frameIds: newFrameIds })

  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
  return { ...state, extensions: newExtensions }
}

/** Remove a frameId from the target that owns it (scans all targets in the extension). */
export function removeFrameId(
  state: RelayState,
  { extensionId, frameId }: { extensionId: string; frameId: string },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }

  for (const [sid, target] of ext.connectedTargets) {
    if (target.frameIds.has(frameId)) {
      const newFrameIds = new Set(target.frameIds)
      newFrameIds.delete(frameId)

      const newTargets = new Map(ext.connectedTargets)
      newTargets.set(sid, { ...target, frameIds: newFrameIds })

      const newExtensions = new Map(state.extensions)
      newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
      return { ...state, extensions: newExtensions }
    }
  }

  return state
}

/**
 * Update URL (and optionally title) on a target.
 * Used by Page.frameNavigated (top-level) and Page.navigatedWithinDocument.
 */
export function updateTargetUrl(
  state: RelayState,
  {
    extensionId,
    sessionId,
    url,
    title,
  }: {
    extensionId: string
    sessionId: string
    url: string
    title?: string
  },
): RelayState {
  const ext = state.extensions.get(extensionId)
  if (!ext) {
    return state
  }
  const target = ext.connectedTargets.get(sessionId)
  if (!target) {
    return state
  }

  const newTargetInfo = {
    ...target.targetInfo,
    url,
    ...(title !== undefined ? { title } : {}),
  }

  const newTargets = new Map(ext.connectedTargets)
  newTargets.set(sessionId, { ...target, targetInfo: newTargetInfo })

  const newExtensions = new Map(state.extensions)
  newExtensions.set(extensionId, { ...ext, connectedTargets: newTargets })
  return { ...state, extensions: newExtensions }
}

/**
 * Update a target URL only when the navigation belongs to that target's main frame.
 *
 * Page.navigatedWithinDocument is also emitted for child frames. Those events use
 * the parent page sessionId when the iframe does not have its own CDP session, so
 * matching on sessionId alone would replace the page target URL with the iframe URL.
 * Chromium page/iframe target IDs are also their main frame IDs, which lets us
 * distinguish a target navigation from a child-frame navigation.
 */
export function updateTargetUrlForFrame(
  state: RelayState,
  {
    extensionId,
    sessionId,
    frameId,
    url,
    title,
  }: {
    extensionId: string
    sessionId: string
    frameId: string
    url: string
    title?: string
  },
): RelayState {
  const target = state.extensions.get(extensionId)?.connectedTargets.get(sessionId)
  if (!target || target.targetId !== frameId) {
    return state
  }

  return updateTargetUrl(state, { extensionId, sessionId, url, title })
}
