import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTION_CHOICE_KEY, extensionSocketUrl, extensionSocketProtocols } from '../src/desktop-connection'
import { nativePort } from './helpers/native-port'

let resolveExtensionEndpoint: typeof import('../src/desktop-connection').resolveExtensionEndpoint

const endpoint = { protocol: 1, installationId: 'a'.repeat(32), instanceId: 'b'.repeat(32), name: 'Travel Agent', port: 45001, extensionKey: 'c'.repeat(64) }
let saved: Record<string, unknown>
let request: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.resetModules()
  ;({ resolveExtensionEndpoint } = await import('../src/desktop-connection'))
  saved = {}
  request = vi.fn(async (host, message) => message.type === 'list' ? { protocol: 1, apps: [endpoint] } : { protocol: 1, endpoint })
  vi.stubGlobal('__TRAVEL_BROWSER_STANDALONE__', false)
  vi.stubGlobal('chrome', { runtime: { connectNative: vi.fn(host => nativePort(message => request(host, message)).port) }, storage: { local: {
    get: async () => saved, set: async (values: Record<string, unknown>) => Object.assign(saved, values),
  } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('desktop pairing', () => {
  it('keeps authentication out of URLs and preserves standalone handshakes', () => {
    const relay = { port: endpoint.port, desktop: { ...endpoint, protocol: 1 as const } }
    expect(extensionSocketUrl(relay).toString()).not.toContain(endpoint.extensionKey)
    expect(extensionSocketProtocols(relay)).toEqual(['travel-browser', `travel-auth.${endpoint.extensionKey}`])
    expect(extensionSocketProtocols({ port: 19989 })).toEqual([])
  })
  it('remembers the installation and discovers a new endpoint after restart', async () => {
    expect((await resolveExtensionEndpoint(19989)).port).toBe(45001)
    expect(saved[CONNECTION_CHOICE_KEY]).toEqual({ mode: 'desktop', installationId: endpoint.installationId })
    request.mockResolvedValue({ protocol: 1, endpoint: { ...endpoint, port: 45002, instanceId: 'd'.repeat(32) } })
    expect((await resolveExtensionEndpoint(19989)).port).toBe(45002)
    expect(request.mock.calls.at(-1)?.[1]).toEqual({ type: 'connect', installationId: endpoint.installationId })
  })
  it('never falls back when the paired application is closed or the native host is absent', async () => {
    saved[CONNECTION_CHOICE_KEY] = { mode: 'desktop', installationId: endpoint.installationId }
    request.mockResolvedValue({ protocol: 1, error: 'The paired Travel Agent is not running' })
    await expect(resolveExtensionEndpoint(19989)).rejects.toThrow('not running')
    request.mockRejectedValue(new Error('Native host not found'))
    await expect(resolveExtensionEndpoint(19989)).rejects.toThrow('Open Travel Agent')
    expect(saved[CONNECTION_CHOICE_KEY]).toEqual({ mode: 'desktop', installationId: endpoint.installationId })
  })
  it('requires a choice when multiple installations are live', async () => {
    request.mockResolvedValue({ protocol: 1, apps: [endpoint, { ...endpoint, installationId: 'd'.repeat(32) }] })
    await expect(resolveExtensionEndpoint(19989)).rejects.toThrow('More than one')
    expect(saved).toEqual({})
  })
  it('rejects an endpoint belonging to another installation', async () => {
    saved[CONNECTION_CHOICE_KEY] = { mode: 'desktop', installationId: 'd'.repeat(32) }
    await expect(resolveExtensionEndpoint(19989)).rejects.toThrow('incompatible')
  })
  it('uses a standalone relay only for an explicit standalone choice', async () => {
    saved[CONNECTION_CHOICE_KEY] = { mode: 'standalone' }
    expect(await resolveExtensionEndpoint(45123)).toEqual({ port: 45123 })
    expect(request).not.toHaveBeenCalled()
  })
})
