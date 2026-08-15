/**
 * Where the desktop shell's relay is listening, published so other processes can find it.
 *
 * The shell prefers the conventional port 19989 — the Chrome extension has it compiled in, so
 * moving off it by default would break the extension for every user who never turns the in-app
 * browser on. But it will not *share*: the `/iab` key is minted per launch and given only to the
 * relay this process forks, so a relay someone else started has never heard of it and the transport
 * would 401 forever. When 19989 is already taken by a stranger, the shell binds a dynamic port
 * instead and publishes it here.
 *
 * **The record holds a port and an owner. It never holds the key.** Discovery answers "where", not
 * "who may"; the secret travels only through the environment of processes the app forks.
 *
 * It lives in `~/.penguin-browser`, next to the relay's own log, rather than in Electron's
 * `userData` — a `penguin-browser` invoked from the user's shell has no idea where a platform's
 * application-support directory is, and this file exists precisely for readers outside the app.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'

/** Base directory, shared with the relay log so a user has one place to look. */
export const DISCOVERY_BASE_DIR = process.env.PENGUIN_BROWSER_HOME || path.join(os.homedir(), '.penguin-browser')

export function discoveryFilePath(baseDir: string = DISCOVERY_BASE_DIR): string {
  return path.join(baseDir, 'desktop-relay.json')
}

export interface RelayDiscoveryRecord {
  /** Loopback port the relay is listening on. */
  port: number
  /** The process that owns it, so a stale record can be told from a live one. */
  pid: number
  /** Random per-launch id. Lets an owner recognise its own record without trusting the pid alone. */
  instanceId: string
  /** ISO timestamp, for humans reading the file. Never used to decide freshness. */
  startedAt: string
}

/** Reads the record, or null when missing, unreadable or malformed. Never throws. */
export function readDiscovery(baseDir: string = DISCOVERY_BASE_DIR): RelayDiscoveryRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(discoveryFilePath(baseDir), 'utf8')) as Partial<RelayDiscoveryRecord>
    if (typeof parsed.port !== 'number' || !Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) {
      return null
    }
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null
    if (typeof parsed.instanceId !== 'string' || parsed.instanceId === '') return null
    return {
      port: parsed.port,
      pid: parsed.pid,
      instanceId: parsed.instanceId,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    }
  } catch {
    return null
  }
}

/** Atomic write, owner-only. Atomic so a reader never sees half a record. */
export function writeDiscovery(record: RelayDiscoveryRecord, baseDir: string = DISCOVERY_BASE_DIR): void {
  const file = discoveryFilePath(baseDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * Removes the record **only if it is still ours**.
 *
 * A shell that crashed and was restarted will have published a new record; deleting unconditionally
 * on the old instance's way out would erase the live one and leave the CLI with nothing to find.
 */
export function clearDiscoveryIfOwned(instanceId: string, baseDir: string = DISCOVERY_BASE_DIR): boolean {
  const current = readDiscovery(baseDir)
  if (!current || current.instanceId !== instanceId) return false
  try {
    fs.unlinkSync(discoveryFilePath(baseDir))
    return true
  } catch {
    return false
  }
}

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

/** Whether something is accepting connections on a loopback port. */
export function isPortListening(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const done = (value: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Decides whether a record may be followed.
 *
 * Both halves matter, and for different reasons. A dead owner means the record outlived its process
 * and the port may since have been taken by something unrelated. A live owner with a closed port
 * means the relay died while the shell lived on. Following either would send a caller — and in the
 * shell's case, its key — somewhere it does not belong.
 *
 * The checks are injected so this can be tested without spawning processes or binding sockets.
 */
export async function isDiscoveryUsable(
  record: RelayDiscoveryRecord | null,
  checks: { isPidAlive: (pid: number) => boolean; isPortListening: (port: number) => Promise<boolean> },
): Promise<boolean> {
  if (!record) return false
  if (!checks.isPidAlive(record.pid)) return false
  return checks.isPortListening(record.port)
}

/**
 * Where a client should send `--iab` requests.
 *
 * The order is a trust order, not a convenience one:
 *
 *   1. **An explicit `--host`.** The caller named a machine; discovery describes *this* one, and a
 *      stale local record must not be read — let alone deleted — because someone pointed the CLI at
 *      a remote relay.
 *   2. **`PENGUIN_BROWSER_HOST`.** Same reasoning, set once in an environment instead of per call.
 *   3. **`PENGUIN_BROWSER_PORT`.** Names a port on this machine, so it overrides discovery but not
 *      a host.
 *   4. **A healthy discovery record**, which is how the desktop app announces a relay that had to
 *      move off the conventional port.
 *   5. **The conventional port.**
 *
 * A stale record is removed as it is found, but only on the paths that actually consulted it.
 */
export async function resolveRelayEndpoint(options: {
  baseDir?: string
  defaultPort: number
  host?: string
  envHost?: string
  envPort?: string
  checks?: { isPidAlive: (pid: number) => boolean; isPortListening: (port: number) => Promise<boolean> }
}): Promise<{ host: string; port: number; source: 'host' | 'env-host' | 'env-port' | 'discovery' | 'default' }> {
  const explicitPort = Number(options.envPort)
  const portFromEnv = Number.isInteger(explicitPort) && explicitPort > 0 ? explicitPort : null

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
  const checks = options.checks ?? { isPidAlive, isPortListening }
  const record = readDiscovery(baseDir)
  if (await isDiscoveryUsable(record, checks)) {
    return { host: '127.0.0.1', port: record!.port, source: 'discovery' }
  }
  if (record) {
    // Stale, and we are the ones who looked: clear it so the next reader does not repeat the probe.
    try {
      fs.unlinkSync(discoveryFilePath(baseDir))
    } catch {
      // Someone else got there first, or the directory is read-only. Harmless either way.
    }
  }
  return { host: '127.0.0.1', port: options.defaultPort, source: 'default' }
}
