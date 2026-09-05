import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startPenguinBrowserCDPRelayServer, type RelayServer } from '../src/relay/cdp-relay.js'
import { writeDesktopRecord, readDesktopRecords, liveDesktopRecords, removeDesktopRecord, desktopRecordIsLive, type DesktopRecord } from '../src/relay/desktop-registry.js'
import { resolveRelayEndpoint } from '../src/relay/relay-discovery.js'
import { assertStandaloneRelayReplacement } from '../src/relay/relay-client.js'
import { TRAVEL_EXTENSION_ID } from '../src/shared/desktop-connection.js'

const roots: string[] = []
const relays: RelayServer[] = []
function temporary() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-pairing-')); roots.push(root); return root }
async function relay(): Promise<DesktopRecord> {
  const desktop = { protocol: 1 as const, installationId: randomBytes(16).toString('hex'),
    instanceId: randomBytes(16).toString('hex'), extensionKey: randomBytes(32).toString('hex'), name: 'Test Desktop' }
  const server = await startPenguinBrowserCDPRelayServer({ port: 0, host: '127.0.0.1', desktop })
  relays.push(server)
  return { ...desktop, port: server.port, pid: process.pid }
}
afterEach(async () => {
  for (const server of relays.splice(0)) await server.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('authenticated Desktop pairing', () => {
  it('discovers live applications, refuses ambiguity, and protects a newer launch from stale cleanup', async () => {
    const baseDir = temporary()
    const first = await relay(); writeDesktopRecord(first, baseDir)
    expect(await resolveRelayEndpoint({ defaultPort: 19989, baseDir })).toMatchObject({ source: 'desktop', port: first.port, instanceId: first.instanceId })
    const second = await relay(); writeDesktopRecord(second, baseDir)
    await expect(resolveRelayEndpoint({ defaultPort: 19989, baseDir })).rejects.toThrow('Multiple Travel Agent')
    const restarted = { ...second, installationId: first.installationId }
    writeDesktopRecord(restarted, baseDir); removeDesktopRecord(first, baseDir)
    expect(readDesktopRecords(baseDir).find(row => row.installationId === first.installationId)?.instanceId).toBe(second.instanceId)
  })

  it('rejects stale credentials, wrong launches, and webpage origins without exposing the connection key', async () => {
    const record = await relay(); const base = `http://127.0.0.1:${record.port}`
    expect(await desktopRecordIsLive(record)).toBe(true)
    expect(await desktopRecordIsLive({ ...record, extensionKey: '0'.repeat(64) })).toBe(false)
    const version = await (await fetch(`${base}/version`)).text()
    expect(version).not.toContain(record.extensionKey)
    const origin = `chrome-extension://${TRAVEL_EXTENSION_ID}`
    expect((await fetch(`${base}/extension`, { headers: { origin } })).status).toBe(401)
    expect((await fetch(`${base}/extension?instanceId=${'0'.repeat(32)}`, { headers: { origin, 'sec-websocket-protocol': `travel-browser, travel-auth.${record.extensionKey}` } })).status).toBe(401)
    expect((await fetch(`${base}/desktop/identity?challenge=${'a'.repeat(64)}`, { headers: { origin: 'https://example.com' } })).status).toBe(403)
    await expect(assertStandaloneRelayReplacement(record.port)).rejects.toThrow('Desktop owns this relay')
    expect(await desktopRecordIsLive(record)).toBe(true)
  })

  it('rejects a reused port even if its process copies the public identity', async () => {
    const record = await relay()
    const impostor = http.createServer((_req, res) => res.end(JSON.stringify({ ...record, proof: '0'.repeat(64) })))
    await new Promise<void>(resolve => impostor.listen(0, '127.0.0.1', resolve))
    try {
      const port = (impostor.address() as { port: number }).port
      const baseDir = temporary(); writeDesktopRecord({ ...record, port }, baseDir)
      expect(await liveDesktopRecords(baseDir)).toEqual([])
    } finally { await new Promise<void>(resolve => impostor.close(() => resolve())) }
  })

  it('ignores malformed, shared-readable, and symlinked discovery records', async () => {
    const baseDir = temporary(); const record = await relay(); writeDesktopRecord(record, baseDir)
    const file = path.join(baseDir, 'desktop-instances', `${record.installationId}.json`)
    if (process.platform !== 'win32') {
      fs.chmodSync(file, 0o644); expect(readDesktopRecords(baseDir)).toEqual([])
      fs.chmodSync(file, 0o600)
      const target = `${file}.target`; fs.renameSync(file, target); fs.symlinkSync(target, file)
      expect(readDesktopRecords(baseDir)).toEqual([]); fs.unlinkSync(file)
    }
    fs.writeFileSync(file, '{'); expect(readDesktopRecords(baseDir)).toEqual([])
  })
})
