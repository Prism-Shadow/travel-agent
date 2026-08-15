import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Penguin Browser extension IDs used for relay-origin validation and Chrome flags.
// The development ID is derived from extension/manifest.json's public key.
export const EXTENSION_IDS = ['fbiciihmfbflenjjaphaljgfnlepnjdf']

/**
 * Reserved backend id for the desktop shell's in-app browser.
 *
 * The relay stores every backend — Chrome extensions and the in-app browser alike — in one
 * registry, because they present the same transport contract. This id is how a session asks for
 * the in-app one specifically, and it is deliberately not a Chrome extension id: nothing loaded
 * into a browser can claim it.
 */
export const IAB_BACKEND_ID = 'travel-agent-iab'

/**
 * Whether a socket peer address is the local machine.
 *
 * Spelled out rather than compared against two literals because the same loopback shows up in
 * several shapes depending on how the client connected and how the stack is configured: plain IPv4,
 * IPv6, and the IPv4-mapped IPv6 form a dual-stack listener reports. Treating `::ffff:127.0.0.1` as
 * remote would break dual-stack hosts; treating `127.0.0.1.evil.com` as local would be a hole. A
 * missing address is refused — an unknown peer is not a local one.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false
  const value = address.trim().toLowerCase()
  if (value === '127.0.0.1' || value === '::1' || value === '[::1]') return true
  // IPv4-mapped IPv6, as a dual-stack listener reports a v4 client.
  const mapped = /^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
  const ipv4 = mapped ? mapped[1] : value
  // The whole 127.0.0.0/8 block is loopback, not just .1.
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4)
  if (!octets) return false
  const parts = octets.slice(1).map(Number)
  if (parts.some((part) => Number.isNaN(part) || part > 255)) return false
  return parts[0] === 127
}

/**
 * Parse a relay host string into HTTP and WebSocket base URLs.
 * Supports both plain hostnames (appends port) and full URLs (uses as-is).
 *
 * Examples:
 *   "192.168.1.10"                        → http://192.168.1.10:19989, ws://192.168.1.10:19989
 *   "https://my-machine-tunnel.traforo.dev" → https://my-machine-tunnel.traforo.dev, wss://my-machine-tunnel.traforo.dev
 */
export function parseRelayHost(host: string, port: number = 19989): { httpBaseUrl: string; wsBaseUrl: string } {
  if (host.startsWith('https://') || host.startsWith('http://')) {
    const url = new URL(host)
    const httpBaseUrl = url.origin
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBaseUrl = `${wsProtocol}//${url.host}`
    return { httpBaseUrl, wsBaseUrl }
  }
  return {
    httpBaseUrl: `http://${host}:${port}`,
    wsBaseUrl: `ws://${host}:${port}`,
  }
}

export function getCdpUrl({
  port = 19989,
  host = '127.0.0.1',
  token,
  extensionId,
  iabTaskId,
  iabSessionId,
  iabRelaySessionId,
}: {
  port?: number
  host?: string
  token?: string
  extensionId?: string | null
  /**
   * The task this connection drives on behalf of (in-app browser sessions only).
   *
   * On the URL rather than on each command because it is a property of the connection: the
   * executor is created for one task and every command it ever sends belongs to that task. The
   * shell checks it against each tab's owner, which is what stops a finished task from writing to
   * a page the user has since been handed.
   */
  iabTaskId?: string
  /**
   * The conversation this connection belongs to (in-app browser sessions only).
   *
   * One desktop shell serves every conversation over a single backend connection, so the relay
   * needs to know which one a client is in before it hands over a list of targets — otherwise a
   * client sees the URLs and titles of conversations it has nothing to do with, well before any
   * ownership check gets a chance to refuse a command.
   */
  iabSessionId?: string
  /**
   * Which relay session this connection is (in-app browser sessions only).
   *
   * The relay records a new or claimed tab as held by this session, and it takes the id from here
   * rather than from the command's parameters — a client that could state its own would be able to
   * take tabs out under another session's claim.
   */
  iabRelaySessionId?: string
} = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  if (extensionId) {
    params.set('extensionId', extensionId)
  }
  if (iabTaskId) {
    params.set('iabTask', iabTaskId)
  }
  if (iabSessionId) {
    params.set('iabSession', iabSessionId)
  }
  if (iabRelaySessionId) {
    params.set('iabRelaySession', iabRelaySessionId)
  }
  const queryString = params.toString()
  const suffix = queryString ? `?${queryString}` : ''
  const { wsBaseUrl } = parseRelayHost(host, port)
  return `${wsBaseUrl}/cdp/${id}${suffix}`
}

export function shouldAutoEnablePenguinBrowser(): boolean {
  return process.env.PENGUIN_BROWSER_AUTO_ENABLE?.toLowerCase() !== 'false'
}

// Use ~/.penguin-browser for logs so each OS user gets their own dir (avoids permission errors on shared machines, see #44)
const LOG_BASE_DIR = path.join(os.homedir(), '.penguin-browser')
export const LOG_FILE_PATH = process.env.PENGUIN_BROWSER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'relay-server.log')
export const LOG_CDP_FILE_PATH =
  process.env.PENGUIN_BROWSER_CDP_LOG_FILE_PATH || path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
