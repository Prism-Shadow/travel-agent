/**
 * Relay endpoint resolution (relay-discovery.ts).
 *
 * Two things are under test. The first is the precedence: a launch identity pins its own
 * application and cannot be overridden; a named host is never second-guessed by local discovery;
 * and only the unnamed path consults the desktop registry. The bug it exists to prevent is a task
 * reaching a relay it does not belong to — the relay's session ids are small integers, so the
 * failure would be "session 3 not found" rather than anything that points at two relays.
 *
 * The second is that this module stays cheap to import. It is loaded by the Electron main process,
 * and the package root is not: cdp-relay's module body mutates `Buffer.prototype`'s inspect hook
 * and pulls in the whole relay dependency graph.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPidAlive, resolveRelayEndpoint } from '../src/relay/relay-discovery.js'

let dir: string

beforeEach(() => {
  // An empty base directory: no desktop records, so the unnamed path lands on the default port.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iab-discovery-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveRelayEndpoint precedence', () => {
  const local = { host: '127.0.0.1' }

  it('prefers an explicit host over everything', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      host: 'remote.example',
      envHost: 'env.example',
      envPort: '20000',
      envInstanceId: '',
    })
    expect(result).toEqual({ host: 'remote.example', port: 20000, source: 'host' })
  })

  it('uses PENGUIN_BROWSER_HOST when no --host was given', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      envHost: 'env.example',
      envInstanceId: '',
    })
    expect(result).toEqual({ host: 'env.example', port: 19989, source: 'env-host' })
  })

  it('uses PENGUIN_BROWSER_PORT over discovery, on this machine', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      envPort: '20000',
      envInstanceId: '',
    })
    expect(result).toEqual({ ...local, port: 20000, source: 'env-port' })
  })

  it('falls back to the conventional port when nothing was named and no application is live', async () => {
    const result = await resolveRelayEndpoint({ baseDir: dir, defaultPort: 19989, envInstanceId: '' })
    expect(result).toEqual({ ...local, port: 19989, source: 'default' })
  })

  it('ignores a non-numeric or out-of-range port override rather than treating it as a port', async () => {
    for (const envPort of ['nonsense', '0', '70000']) {
      const result = await resolveRelayEndpoint({ baseDir: dir, defaultPort: 19989, envPort, envInstanceId: '' })
      expect(result.port, envPort).toBe(19989)
    }
  })

  it('pairs an env port with an explicit host rather than dropping either', async () => {
    const result = await resolveRelayEndpoint({
      baseDir: dir,
      defaultPort: 19989,
      host: 'remote.example',
      envPort: '20000',
      envInstanceId: '',
    })
    expect(result).toEqual({ host: 'remote.example', port: 20000, source: 'host' })
  })

  it('refuses to let a desktop-scoped call be redirected or left without its port', async () => {
    // The application that started this task is the only relay it may reach. A named host is an
    // attempt to go elsewhere; a missing port means the application is gone. Both are errors, and
    // neither consults the registry or the default port.
    const instanceId = 'a'.repeat(32)
    await expect(
      resolveRelayEndpoint({ baseDir: dir, defaultPort: 19989, envInstanceId: instanceId }),
    ).rejects.toThrow(/Desktop browser connection is unavailable/)
    await expect(
      resolveRelayEndpoint({
        baseDir: dir,
        defaultPort: 19989,
        envInstanceId: instanceId,
        envPort: '20000',
        host: 'remote.example',
      }),
    ).rejects.toThrow(/cannot be overridden/)
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
    const module = await import('../src/relay/relay-discovery.js')
    expect(typeof module.resolveRelayEndpoint).toBe('function')
    const after = Object.getOwnPropertyDescriptor(
      Buffer.prototype,
      Symbol.for('nodejs.util.inspect.custom'),
    )
    expect(after).toEqual(before)

    // And statically: the module's imports are node builtins only.
    const source = fs.readFileSync(new URL('../src/relay/relay-discovery.ts', import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/^import\s+[^'"]*from\s+'([^']+)'/gm)].map((m) => m[1])
    expect(specifiers.every((specifier) => specifier.startsWith('node:'))).toBe(true)
  })
})
