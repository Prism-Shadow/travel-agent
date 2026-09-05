/**
 * The small shared-state files under `~/.penguin-browser`, and the rules for reading them.
 *
 * They exist because one process has a fact another needs and no other channel to it: the
 * desktop shell publishes where its relay is, and the app records which browser backend a
 * conversation chose, so a `penguin-browser` the agent starts later — from a shell that knows
 * nothing about Electron's application-support directory — has exactly one place to look.
 * The directory is shared with the relay's own log for the same reason.
 *
 * ## Relay discovery
 *
 * The desktop shell binds an OS-assigned port and publishes an installation-scoped record through
 * desktop-registry.ts (`desktop-instances/<installationId>.json`). Discovery answers "where"
 * and, for those records, proves "who": the record carries an extension credential (never the
 * per-launch `/iab` key, which travels only through the environment of processes the app forks),
 * and a reader must obtain a fresh HMAC proof from the live relay before following it. A record
 * whose owner is dead, whose port was reused, or whose proof fails is not a relay.
 *
 * The conventional port 19989 belongs to standalone `penguin-browser serve`. It is the last resort
 * here, never a fallback for a desktop-scoped call: a task that was started by an application must
 * reach that application's relay or fail, because a stranger's relay has never heard of its
 * session and would refuse it forever, silently.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/** Base directory, shared with the relay log so a user has one place to look. */
export const DISCOVERY_BASE_DIR = process.env.PENGUIN_BROWSER_HOME || path.join(os.homedir(), '.penguin-browser')

/** Whether a process exists. Signal 0 tests existence without delivering anything. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists under another user, which still counts as alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Where a client should send its relay requests.
 *
 * The order is a trust order, not a convenience one:
 *
 *   1. **A launch identity in the environment** (`PENGUIN_RELAY_INSTANCE_ID`, set by the desktop
 *      shell for every process it spawns). The call belongs to that application: its port is
 *      pinned, the relay must prove it is that launch, and nothing below may override it — not a
 *      `--host`, not an inherited `PENGUIN_BROWSER_HOST`. An application that is gone is an error,
 *      never a reason to go looking for another relay.
 *   2. **An explicit `--host`.** The caller named a machine; local discovery describes *this* one
 *      and is not consulted.
 *   3. **`PENGUIN_BROWSER_HOST`.** Same reasoning, set once in an environment instead of per call.
 *   4. **`PENGUIN_BROWSER_PORT`.** Names a port on this machine, so it overrides discovery but not
 *      a host.
 *   5. **One live, authenticated desktop record.** Two or more is an error: discovery never picks
 *      an application on the caller's behalf.
 *   6. **The conventional standalone port.**
 */
export async function resolveRelayEndpoint(options: {
  baseDir?: string
  defaultPort: number
  host?: string
  envHost?: string
  envPort?: string
  envInstanceId?: string
}): Promise<{ host: string; port: number; source: 'host' | 'env-host' | 'env-port' | 'desktop' | 'default'; instanceId?: string }> {
  const explicitPort = Number(options.envPort)
  const portFromEnv = Number.isInteger(explicitPort) && explicitPort > 0 && explicitPort <= 65535 ? explicitPort : null

  const instanceId = options.envInstanceId ?? process.env.PENGUIN_RELAY_INSTANCE_ID
  if (instanceId) {
    if (!portFromEnv) throw new Error('The Desktop browser connection is unavailable. Reopen the application; no replacement relay was started.')
    if (options.host || options.envHost) throw new Error('Desktop browser endpoint cannot be overridden')
    await verifyDesktopInstance(portFromEnv, instanceId)
    return { host: '127.0.0.1', port: portFromEnv, source: 'desktop', instanceId }
  }

  if (options.host) {
    return { host: options.host, port: portFromEnv ?? options.defaultPort, source: 'host' }
  }
  if (options.envHost) {
    return { host: options.envHost, port: portFromEnv ?? options.defaultPort, source: 'env-host' }
  }
  if (portFromEnv !== null) {
    return { host: '127.0.0.1', port: portFromEnv, source: 'env-port' }
  }

  const baseDir = options.baseDir ?? DISCOVERY_BASE_DIR
  const { liveDesktopRecords } = await import('./desktop-registry.js')
  const desktops = await liveDesktopRecords(baseDir)
  if (desktops.length > 1) throw new Error('Multiple Travel Agent instances are running. Start this task from the intended application.')
  if (desktops.length === 1) {
    const desktop = desktops[0]!
    return { host: '127.0.0.1', port: desktop.port, source: 'desktop', instanceId: desktop.instanceId }
  }
  return { host: '127.0.0.1', port: options.defaultPort, source: 'default' }
}

export async function verifyDesktopInstance(port: number, instanceId: string): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(1500) })
    const identity = await response.json() as { instanceId?: string }
    if (response.ok && identity.instanceId === instanceId) return
  } catch { /* A missing or replaced relay must not trigger standalone auto-start. */ }
  throw new Error('The task\'s Travel Agent browser connection is unavailable. Reopen the application; no replacement relay was started.')
}

// —— The user's choice of browser backend ————————————————————————————————————————————————

/**
 * Which browser the user wants the agent to drive, **per conversation**.
 *
 * The design makes this a decision taken at the start of a task and never during one: the two
 * backends have different logins, different cookies and different fingerprints, and switching
 * halfway through discards the page state the task was built on. The design goes further — the switch has
 * to be a *visible* choice, because it changes whose browser an order is placed in.
 *
 * Keyed by Session, not global. Two conversations can legitimately want different browsers — one
 * booking on a site the user is already signed into in their own Chrome, another running in the
 * app's own profile — and a single global setting would make changing either one change both.
 *
 * The user makes the choice in the desktop shell, which owns the in-app browser. This is how it
 * reaches the CLI, a separate process started later by the agent: the shell writes it, `session new
 * --iab` reads it for the conversation named by `PENGUIN_SESSION_ID`, and a caller asking for the
 * in-app browser in a conversation set to Chrome is told so instead of quietly getting the other
 * one.
 *
 * Kept in its own file rather than in the discovery record above, because that one is rewritten
 * every time the relay starts and a preference must survive that.
 */
export type BrowserBackend = 'iab' | 'extension'
export type BrowserBackendRequest = BrowserBackend | 'auto'
export type StandaloneBrowserMode = 'headless' | 'cloud' | 'direct'

/**
 * Resolves the CLI's backend request against the desktop shell's per-conversation choice.
 *
 * A recorded choice is authority, not a hint: an agent cannot force the other browser by changing
 * flags. `auto` is the normal task path. When there is no record, extension preserves the CLI's
 * standalone/plain-web behaviour; Desktop writes an explicit `iab` record before its first task.
 */
export function resolveBackendRequest(input: {
  requested: BrowserBackendRequest
  preference: BrowserBackend | null
}): BrowserBackend {
  if (input.requested === 'auto') return input.preference ?? 'extension'
  if (input.preference !== null && input.preference !== input.requested) {
    const chosen = input.preference === 'iab' ? 'the in-app browser' : 'your own Chrome'
    throw new Error(
      `This conversation is set to use ${chosen}. Change the choice in the browser panel before ` +
        `starting the task; the browser backend cannot be overridden from the agent CLI.`,
    )
  }
  return input.requested
}

/**
 * Direct/headless/cloud are standalone and developer modes, not hidden third choices for a Desktop
 * conversation. Refuse them whenever Desktop has recorded either user-visible backend.
 */
export function assertStandaloneBrowserModeAllowed(
  preference: BrowserBackend | null,
  mode: StandaloneBrowserMode,
): void {
  if (preference === null) return
  throw new Error(
    `This task belongs to a desktop conversation set to ${preference}. ${mode} mode cannot ` +
      'override it; change the Browser menu between tasks instead.',
  )
}

/** Bumped if the shape changes incompatibly; an unknown version reads as "no preference". */
export const BACKEND_PREFERENCE_VERSION = 2

/**
 * How many conversations' choices are kept.
 *
 * Sessions accumulate forever and their preferences do not expire on their own, so the file is
 * bounded and the oldest entries are dropped. Losing one means that conversation falls back to the
 * default, which is the same thing that happens the first time it is used.
 */
export const MAX_BACKEND_PREFERENCES = 200

export interface BackendPreferenceFile {
  version: number
  /** Session id → backend, in insertion order: the first entries are the oldest. */
  backends: Record<string, BrowserBackend>
}

export function backendPreferencePath(baseDir: string = DISCOVERY_BASE_DIR): string {
  return path.join(baseDir, 'desktop-backend.json')
}

function readBackendFile(baseDir: string): BackendPreferenceFile {
  try {
    const raw = fs.readFileSync(backendPreferencePath(baseDir), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<BackendPreferenceFile>
    if (parsed?.version !== BACKEND_PREFERENCE_VERSION) return empty()
    if (!parsed.backends || typeof parsed.backends !== 'object') return empty()
    const backends: Record<string, BrowserBackend> = {}
    for (const [sessionId, backend] of Object.entries(parsed.backends)) {
      if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) continue
      if (backend === 'iab' || backend === 'extension') backends[sessionId] = backend
    }
    return { version: BACKEND_PREFERENCE_VERSION, backends }
  } catch {
    // Missing, unreadable, or written by a different version: no preferences, which is a state the
    // caller already handles. This file must never be able to stop a session starting.
    return empty()
  }
}

function empty(): BackendPreferenceFile {
  return { version: BACKEND_PREFERENCE_VERSION, backends: {} }
}

/**
 * One conversation's choice, or null when it has not made one.
 *
 * Null is not the same as `'iab'`: "no preference" means the default applies, and the default is
 * the caller's to decide — the in-app browser on the desktop, and nothing at all in a plain web
 * deployment, where there is no in-app browser to prefer.
 */
export function readBackendPreference(
  sessionId: string,
  baseDir: string = DISCOVERY_BASE_DIR,
): BrowserBackend | null {
  return readBackendFile(baseDir).backends[sessionId] ?? null
}

/** Every recorded choice, for the shell to show the right state per conversation. */
export function readAllBackendPreferences(
  baseDir: string = DISCOVERY_BASE_DIR,
): Record<string, BrowserBackend> {
  return readBackendFile(baseDir).backends
}

/**
 * Records one conversation's choice.
 *
 * Written through a temporary file and renamed, so a crash mid-write leaves the previous choices
 * rather than a truncated file. Windows cannot always rename over an existing destination, so the
 * fallback briefly parks the old file as a backup and restores it if replacement fails.
 */
export function writeBackendPreference(
  sessionId: string,
  backend: BrowserBackend,
  baseDir: string = DISCOVERY_BASE_DIR,
): boolean {
  if (!sessionId) return false
  const current = readBackendFile(baseDir)
  // Re-inserted rather than updated in place, so the most recently touched conversation is the last
  // to be pruned.
  delete current.backends[sessionId]
  current.backends[sessionId] = backend

  const entries = Object.entries(current.backends)
  const kept = entries.slice(Math.max(0, entries.length - MAX_BACKEND_PREFERENCES))
  const record: BackendPreferenceFile = {
    version: BACKEND_PREFERENCE_VERSION,
    backends: Object.fromEntries(kept),
  }

  const target = backendPreferencePath(baseDir)
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`
  const backup = `${target}.${randomBytes(6).toString('hex')}.bak`
  try {
    fs.mkdirSync(baseDir, { recursive: true })
    fs.writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf-8', mode: 0o600 })
    try {
      fs.renameSync(temporary, target)
    } catch (replaceError) {
      // `rename(temp, existing)` is atomic on POSIX but fails on Windows. Moving the valid old
      // record aside first lets us replace it without ever truncating it in place.
      if (!fs.existsSync(target)) throw replaceError
      fs.renameSync(target, backup)
      try {
        fs.renameSync(temporary, target)
      } catch (secondError) {
        try {
          if (!fs.existsSync(target)) fs.renameSync(backup, target)
        } catch {
          // The return value below tells callers not to commit their in-memory selection.
        }
        throw secondError
      }
      try {
        fs.unlinkSync(backup)
      } catch {
        // A stale backup is harmless; the canonical target already contains the complete record.
      }
    }
    return true
  } catch {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // Nothing to clean up.
    }
    try {
      if (fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target)
    } catch {
      // Best effort restoration; callers receive false and keep their prior in-memory choice.
    }
    return false
  }
}
