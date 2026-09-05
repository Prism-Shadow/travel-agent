/**
 * Shared utilities for connecting to the relay server.
 * Used by both MCP and CLI.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { getListeningPidsForPort } from '../browser/kill-port.js'
import { packageRoot } from '../shared/package-paths.js'
import { VERSION, sleep, LOG_FILE_PATH } from '../shared/utils.js'
import { readAgentIdentity } from './agent-identity.js'
import { resolveRelayEndpoint, verifyDesktopInstance, readBackendPreference } from './relay-discovery.js'

const __filename = fileURLToPath(import.meta.url)

export const RELAY_PORT = Number(process.env.PENGUIN_BROWSER_PORT) || 19989

/**
 * One resolution per (host, desktop-task) pair for the life of the process. A CLI invocation asks
 * once; a long-lived importer (an MCP server) may ask with different hosts, and must not be handed
 * the first caller's answer. A rejected resolution is dropped rather than cached, so a relay that
 * was briefly unreachable is asked about again on the next call instead of failing forever.
 */
const localEndpoints = new Map<string, ReturnType<typeof resolveRelayEndpoint>>()
export async function resolveLocalRelay(host?: string) {
  // An externally hosted dev server cannot inherit Desktop's launch environment. Its recorded
  // conversation choice still requires a live application; losing discovery must not auto-start CLI.
  const identity = readAgentIdentity()
  const desktopTask = identity !== null && readBackendPreference(identity.sessionId) !== null
  const externalDesktopTask = desktopTask && !process.env.PENGUIN_RELAY_INSTANCE_ID
  if (externalDesktopTask && host) throw new Error('A Desktop conversation cannot override its application endpoint')
  // A long-lived external server may still carry an older shell's unscoped port. A recorded
  // Desktop conversation follows authenticated application discovery, never that stale override.
  const cacheKey = `${externalDesktopTask ? 'desktop' : 'any'}\u0000${host ?? ''}`
  let pending = localEndpoints.get(cacheKey)
  if (!pending) {
    pending = resolveRelayEndpoint({ defaultPort: RELAY_PORT, host,
      envHost: externalDesktopTask ? undefined : process.env.PENGUIN_BROWSER_HOST,
      envPort: externalDesktopTask ? undefined : process.env.PENGUIN_BROWSER_PORT })
    localEndpoints.set(cacheKey, pending)
    pending.catch(() => { if (localEndpoints.get(cacheKey) === pending) localEndpoints.delete(cacheKey) })
  }
  const endpoint = await pending
  if (desktopTask && endpoint.source !== 'desktop') {
    throw new Error('This conversation requires its Travel Agent application. Reopen it; no replacement relay was started.')
  }
  if (endpoint.instanceId) await verifyDesktopInstance(endpoint.port, endpoint.instanceId)
  return endpoint
}

export type ExtensionStatus = {
  extensionId: string
  stableKey?: string
  browser: string | null
  profile: { email: string; id: string } | null
  activeTargets: number
  penguinBrowserVersion: string | null
}

function relayAuthHeaders(): Record<string, string> {
  const token = process.env.PENGUIN_BROWSER_TOKEN
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getRelayServerVersion(port?: number): Promise<string | null> {
  port ??= (await resolveLocalRelay()).port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(2000),
      headers: relayAuthHeaders(),
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as { version: string }
    return data.version
  } catch {
    return null
  }
}

/**
 * Poll /version until a relay responds or timeout expires.
 * Used during startup races where a relay may have bound the port
 * but isn't serving HTTP yet (issue #75).
 */
export async function waitForRelayVersion({
  port = RELAY_PORT,
  timeoutMs = 2000,
  intervalMs = 200,
}: {
  port?: number
  timeoutMs?: number
  intervalMs?: number
} = {}): Promise<string | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const version = await getRelayServerVersion(port)
    if (version) {
      return version
    }
    await sleep(intervalMs)
  }
  return null
}

export async function getExtensionStatus(
  port?: number,
): Promise<{ connected: boolean; activeTargets: number; penguinBrowserVersion: string | null } | null> {
  port ??= (await resolveLocalRelay()).port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/extension/status`, {
      signal: AbortSignal.timeout(500),
      headers: relayAuthHeaders(),
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as {
      connected: boolean
      activeTargets: number
      penguinBrowserVersion: string | null
    }
  } catch {
    return null
  }
}

export async function getExtensionsStatus(port?: number): Promise<ExtensionStatus[]> {
  port ??= (await resolveLocalRelay()).port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/extensions/status`, {
      signal: AbortSignal.timeout(2000),
      headers: relayAuthHeaders(),
    })
    if (!response.ok) {
      const fallback = await fetch(`http://127.0.0.1:${port}/extension/status`, {
        signal: AbortSignal.timeout(2000),
        headers: relayAuthHeaders(),
      })
      if (!fallback.ok) {
        return []
      }

      const fallbackData = (await fallback.json()) as {
        connected: boolean
        activeTargets: number
        browser: string | null
        profile: { email: string; id: string } | null
        penguinBrowserVersion?: string | null
      }

      if (!fallbackData?.connected) {
        return []
      }

      return [
        {
          extensionId: 'default',
          stableKey: undefined,
          browser: fallbackData.browser,
          profile: fallbackData.profile,
          activeTargets: fallbackData.activeTargets,
          penguinBrowserVersion: fallbackData.penguinBrowserVersion || null,
        },
      ]
    }

    const data = (await response.json()) as {
      extensions: ExtensionStatus[]
    }

    return data.extensions || []
  } catch {
    return []
  }
}

/**
 * Wait for at least one extension to appear in extensions status.
 * Returns connected extension entries, or [] on timeout.
 */
export async function waitForConnectedExtensions(
  options: {
    port?: number
    timeoutMs?: number
    pollIntervalMs?: number
    logger?: { log: (...args: any[]) => void }
  } = {},
): Promise<ExtensionStatus[]> {
  const { timeoutMs = 5000, pollIntervalMs = 200, logger } = options
  const port = options.port ?? (await resolveLocalRelay()).port
  const startTime = Date.now()

  logger?.log(pc.dim('Waiting for extension to connect...'))

  while (Date.now() - startTime < timeoutMs) {
    const extensions = await getExtensionsStatus(port)
    if (extensions.length > 0) {
      logger?.log(pc.green('Extension connected'))
      return extensions
    }
    await sleep(pollIntervalMs)
  }

  logger?.log(pc.yellow('Extension did not connect within timeout'))
  return []
}

/** Explicit replacement is a standalone operation; an application owns its own lifetime. */
export async function assertStandaloneRelayReplacement(port: number): Promise<void> {
  if (process.env.PENGUIN_RELAY_INSTANCE_ID) throw new Error('Desktop owns this relay. Restart the application instead.')
  let identity: { version?: string; instanceId?: string }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(1500), headers: relayAuthHeaders(),
    })
    if (!response.ok) throw new Error('Unrecognized listener')
    identity = await response.json() as typeof identity
  } catch { throw new Error(`Port ${port} belongs to an unrecognized process; it was not stopped.`) }
  if (identity.instanceId) throw new Error('Desktop owns this relay. Restart the application instead.')
  if (typeof identity.version !== 'string') throw new Error('Unrecognized relay; it was not stopped.')
}

/**
 * Compare two semver versions. Returns:
 * - negative if v1 < v2
 * - 0 if v1 === v2
 * - positive if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 !== p2) {
      return p1 - p2
    }
  }
  return 0
}

/**
 * Check if the running penguin-browser package is older than the version the extension was built with.
 * The extension bundles the penguin-browser version at build time. If the extension reports a newer
 * version, it means the user's CLI/MCP needs updating.
 * Returns a warning message if outdated, null otherwise.
 */
export function getExtensionOutdatedWarning(extensionPenguinBrowserVersion: string | null | undefined): string | null {
  if (!extensionPenguinBrowserVersion) {
    return null
  }
  if (compareVersions(extensionPenguinBrowserVersion, VERSION) > 0) {
    return `Penguin Browser ${VERSION} is outdated (extension requires ${extensionPenguinBrowserVersion}). Run \`npm install -g penguin-browser@latest\` or update the penguin-browser package in your project.`
  }
  return null
}

export interface EnsureRelayServerOptions {
  logger?: { log: (...args: any[]) => void }
  /** Require a compatible version; an incompatible existing relay is never stopped automatically. */
  restartOnVersionMismatch?: boolean
  /** Pass additional environment variables to the relay server process */
  env?: Record<string, string>
}

export function getRelayServerEntryPath(clientFilename: string, packageDirectory: string = packageRoot()): string {
  const isSource = clientFilename.endsWith('.ts')
  return path.join(packageDirectory, isSource ? 'src' : 'dist', `start-relay-server.${isSource ? 'ts' : 'js'}`)
}

// Module-level dedup: if ensureRelayServer is called concurrently within the
// same process (e.g. two MCP tool handlers at once), only one spawn runs.
let pendingEnsure: Promise<true | undefined> | null = null

/**
 * Ensures the relay server is running. Starts it if not running.
 * Never stops an existing process. Replacement is an explicit standalone CLI operation.
 * Concurrent calls within the same process are deduplicated.
 */
export async function ensureRelayServer(options: EnsureRelayServerOptions = {}): Promise<true | undefined> {
  if (pendingEnsure) {
    return pendingEnsure
  }
  pendingEnsure = ensureRelayServerImpl(options).finally(() => {
    pendingEnsure = null
  })
  return pendingEnsure
}

async function ensureRelayServerImpl(options: EnsureRelayServerOptions = {}): Promise<true | undefined> {
  const { logger, restartOnVersionMismatch = true, env: additionalEnv } = options
  const endpoint = await resolveLocalRelay()
  if (endpoint.source === 'desktop') return
  const port = endpoint.port
  const serverVersion = await getRelayServerVersion(port)

  if (serverVersion === VERSION) {
    return
  }

  // Don't restart if server version is higher than our version.
  // This prevents older clients from killing a newer server.
  if (serverVersion !== null && compareVersions(serverVersion, VERSION) > 0) {
    return
  }

  if (serverVersion !== null) {
    if (restartOnVersionMismatch) {
      throw new Error(`Relay version mismatch (server: ${serverVersion}, client: ${VERSION}). Restart its owning application or explicitly replace a standalone relay; it was not stopped.`)
    } else {
      // Server is running but different version, just use it
      return
    }
  } else {
    const listeningPids = await getListeningPidsForPort({ port: port }).catch(() => [])
    if (listeningPids.length > 0) {
      // Something is on the port but /version didn't respond. It might be a
      // relay that's still starting (race with another CLI/MCP instance).
      // Poll /version briefly before reporting an occupied port (issue #75).
      const foundVersion = await waitForRelayVersion({ port: port })
      if (foundVersion) {
        // A relay came up while we waited; use it
        if (foundVersion === VERSION || compareVersions(foundVersion, VERSION) > 0) {
          return
        }
        if (!restartOnVersionMismatch) {
          return
        }
        throw new Error(`Relay version mismatch on port ${port}; the existing process was not stopped.`)
      } else {
        throw new Error(`Port ${port} is already in use; the existing process was not stopped. Choose another standalone port.`)
      }
    }

    logger?.log(pc.dim('CDP relay server not running, starting it...'))
  }

  // Detect if we're running from source (.ts) or compiled (.js)
  // This handles: tsx, vite-node, ts-node, or direct node on compiled output
  const isRunningFromSource = __filename.endsWith('.ts')
  const scriptPath = getRelayServerEntryPath(__filename)

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Relay server entry point does not exist: ${scriptPath}`)
  }

  const serverProcess = spawn(isRunningFromSource ? 'tsx' : process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...additionalEnv, PENGUIN_BROWSER_PORT: String(port) },
  })

  serverProcess.unref()

  const startTimeoutMs = 5000
  const startTime = Date.now()

  while (Date.now() - startTime < startTimeoutMs) {
    await sleep(200)
    const newVersion = await getRelayServerVersion(port)
    if (newVersion) {
      logger?.log(pc.green('CDP relay server started successfully'))
      await sleep(1000)
      return true
    }
  }

  const waitedMs = Date.now() - startTime
  throw new Error(`Failed to start CDP relay server within ${waitedMs}ms. Check logs at: ${LOG_FILE_PATH}`)
}
