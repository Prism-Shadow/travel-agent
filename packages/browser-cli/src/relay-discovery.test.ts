/**
 * Desktop relay discovery (relay-discovery.ts).
 *
 * Two things are under test. The first is the decision logic: which record may be followed, and
 * what happens to one that may not. The bug it exists to prevent is the shell attaching to a relay
 * it did not start — the /iab key is minted per launch, so a stranger's relay refuses it forever,
 * silently, for anyone who ran `penguin-browser serve` before opening the app.
 *
 * The second is that this module stays cheap to import. It is loaded by the Electron main process,
 * and the package root is not: cdp-relay's module body mutates `Buffer.prototype`'s inspect hook
 * and pulls in the whole relay dependency graph.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import {
  clearDiscoveryIfOwned,
  discoveryFilePath,
  isDiscoveryUsable,
  isPidAlive,
  isPortListening,
  readDiscovery,
  resolveRelayEndpoint,
  writeDiscovery,
} from './relay-discovery.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iab-discovery-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const healthy = { isPidAlive: () => true, isPortListening: async () => true }

describe('record round-trip', () => {
  it('reads back what it wrote', () => {
    writeDiscovery({ port: 41234, pid: 999, instanceId: 'abc', startedAt: '2026-08-15T00:00:00.000Z' }, dir)
    expect(readDiscovery(dir)).toEqual({
      port: 41234,
      pid: 999,
      instanceId: 'abc',
      startedAt: '2026-08-15T00:00:00.000Z',
    })
  })

  it('never writes anything resembling a secret', () => {
    // Discovery answers "where", not "who may": the key travels only through the environment of
    // processes the app forks.
    writeDiscovery({ port: 1, pid: 2, instanceId: 'abc', startedAt: 'now' }, dir)
    const raw = fs.readFileSync(discoveryFilePath(dir), 'utf8')
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['instanceId', 'pid', 'port', 'startedAt'])
    expect(raw.toLowerCase()).not.toMatch(/\bkey\b|secret|token|password/)
  })

  it('writes owner-only permissions', () => {
    writeDiscovery({ port: 1, pid: 2, instanceId: 'a', startedAt: '' }, dir)
    expect(fs.statSync(discoveryFilePath(dir)).mode & 0o777).toBe(0o600)
  })

  it('leaves no temporary file behind, so a reader never sees a partial record', () => {
    writeDiscovery({ port: 1, pid: 2, instanceId: 'a', startedAt: '' }, dir)
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('returns null when there is no record', () => {
    expect(readDiscovery(dir)).toBeNull()
  })

  it.each([
    ['not JSON', '{{{'],
    ['a missing port', JSON.stringify({ pid: 1, instanceId: 'a' })],
    ['a fractional port', JSON.stringify({ port: 1.5, pid: 1, instanceId: 'a' })],
    ['a port above the range', JSON.stringify({ port: 70000, pid: 1, instanceId: 'a' })],
    ['a zero port', JSON.stringify({ port: 0, pid: 1, instanceId: 'a' })],
    ['a missing pid', JSON.stringify({ port: 41234, instanceId: 'a' })],
    ['a missing instanceId', JSON.stringify({ port: 41234, pid: 1 })],
  ])('returns null for %s', (_label, contents) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(discoveryFilePath(dir), contents)
    expect(readDiscovery(dir)).toBeNull()
  })
})

describe('isDiscoveryUsable', () => {
  const record = { port: 41234, pid: 1, instanceId: 'a', startedAt: '' }

  it('accepts a live owner on a listening port', async () => {
    expect(await isDiscoveryUsable(record, healthy)).toBe(true)
  })

  it('refuses a record whose owner is gone', async () => {
    // The port may since have been taken by something unrelated; following it would send this
    // run's key to a stranger.
    expect(
      await isDiscoveryUsable(record, { isPidAlive: () => false, isPortListening: async () => true }),
    ).toBe(false)
  })

  it('refuses a record whose port is dead', async () => {
    expect(
      await isDiscoveryUsable(record, { isPidAlive: () => true, isPortListening: async () => false }),
    ).toBe(false)
  })

  it('refuses a missing record', async () => {
    expect(await isDiscoveryUsable(null, healthy)).toBe(false)
  })
})

describe('clearDiscoveryIfOwned', () => {
  it('removes a record this instance published', () => {
    writeDiscovery({ port: 1, pid: 2, instanceId: 'mine', startedAt: '' }, dir)
    expect(clearDiscoveryIfOwned('mine', dir)).toBe(true)
    expect(readDiscovery(dir)).toBeNull()
  })

  it('leaves another instance record alone', () => {
    // A shell that crashed and restarted has already published a new record; deleting
    // unconditionally on the old instance's way out would erase the live one.
    writeDiscovery({ port: 1, pid: 2, instanceId: 'theirs', startedAt: '' }, dir)
    expect(clearDiscoveryIfOwned('mine', dir)).toBe(false)
    expect(readDiscovery(dir)?.instanceId).toBe('theirs')
  })

  it('is a no-op when there is nothing to remove', () => {
    expect(clearDiscoveryIfOwned('mine', dir)).toBe(false)
  })
})

describe('resolveRelayEndpoint precedence', () => {
  const local = { host: '127.0.0.1' }

  it('prefers an explicit host over everything, and does not read discovery', async () => {
    // The caller named a machine. Discovery describes *this* one, so consulting it — let alone
    // deleting a stale record — would be answering a question nobody asked.
    writeDiscovery({ port: 41234, pid: 1, instanceId: 'a', startedAt: '' }, dir)
    const probed = { isPidAlive: () => false, isPortListening: async () => false }
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      host: 'remote.example',
      envHost: 'env.example',
      envPort: '20000',
      checks: probed,
    })
    expect(result).toEqual({ host: 'remote.example', port: 20000, source: 'host' })
    // The stale record survives: this path never looked at it.
    expect(readDiscovery(dir)).not.toBeNull()
  })

  it('uses PENGUIN_BROWSER_HOST when no --host was given', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      envHost: 'env.example',
      checks: healthy,
    })
    expect(result).toEqual({ host: 'env.example', port: 19989, source: 'env-host' })
  })

  it('leaves a stale local record alone when a remote host was named', async () => {
    writeDiscovery({ port: 41234, pid: 1, instanceId: 'a', startedAt: '' }, dir)
    await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      envHost: 'env.example',
      checks: { isPidAlive: () => false, isPortListening: async () => false },
    })
    expect(readDiscovery(dir)).not.toBeNull()
  })

  it('uses PENGUIN_BROWSER_PORT over discovery, on this machine', async () => {
    writeDiscovery({ port: 41234, pid: 1, instanceId: 'a', startedAt: '' }, dir)
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      envPort: '20000',
      checks: healthy,
    })
    expect(result).toEqual({ ...local, port: 20000, source: 'env-port' })
  })

  it('follows a healthy discovery record when nothing was named', async () => {
    writeDiscovery({ port: 41234, pid: 1, instanceId: 'a', startedAt: '' }, dir)
    const result = await resolveRelayEndpoint({ baseDir: dir, defaultPort: 19989, checks: healthy })
    expect(result).toEqual({ ...local, port: 41234, source: 'discovery' })
  })

  it('falls back to the conventional port and clears a stale record', async () => {
    writeDiscovery({ port: 41234, pid: 1, instanceId: 'a', startedAt: '' }, dir)
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      checks: { isPidAlive: () => false, isPortListening: async () => true },
    })
    expect(result).toEqual({ ...local, port: 19989, source: 'default' })
    expect(readDiscovery(dir)).toBeNull()
  })

  it('falls back when there is no record at all', async () => {
    const result = await resolveRelayEndpoint({ baseDir: dir, defaultPort: 19989, checks: healthy })
    expect(result).toEqual({ ...local, port: 19989, source: 'default' })
  })

  it('ignores a non-numeric port override rather than treating it as a port', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      envPort: 'nonsense',
      checks: healthy,
    })
    expect(result.port).toBe(19989)
  })

  it('pairs an env port with an explicit host rather than dropping either', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      host: 'remote.example',
      envPort: '20000',
      checks: healthy,
    })
    expect(result).toEqual({ host: 'remote.example', port: 20000, source: 'host' })
  })
})

describe('isPortListening', () => {
  it('is true for a port something is listening on', async () => {
    const server = net.createServer()
    const port: number = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
    })
    expect(await isPortListening(port)).toBe(true)
    await new Promise((resolve) => server.close(resolve))
    expect(await isPortListening(port)).toBe(false)
  })
})

describe('isPidAlive', () => {
  it('recognises this process and rejects impossible pids', () => {
    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
  })
})

describe('import cost', () => {
  it('does not pull in cdp-relay or its global side effects', async () => {
    // The Electron main process imports this module. cdp-relay's module body mutates
    // Buffer.prototype's inspect hook and loads the whole relay dependency graph, so reaching it
    // from here would impose a global change and a startup cost just to read a JSON file.
    const before = Object.getOwnPropertyDescriptor(
      Buffer.prototype,
      Symbol.for('nodejs.util.inspect.custom'),
    )
    const module = await import('./relay-discovery.js')
    expect(typeof module.readDiscovery).toBe('function')
    const after = Object.getOwnPropertyDescriptor(
      Buffer.prototype,
      Symbol.for('nodejs.util.inspect.custom'),
    )
    expect(after).toEqual(before)

    // And statically: the module's imports are node builtins only.
    const source = fs.readFileSync(new URL('./relay-discovery.ts', import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/^import\s+[^'"]*from\s+'([^']+)'/gm)].map((m) => m[1])
    expect(specifiers.every((specifier) => specifier.startsWith('node:'))).toBe(true)
  })
})
