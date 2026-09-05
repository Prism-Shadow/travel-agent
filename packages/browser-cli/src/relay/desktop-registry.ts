/** Installation-scoped discovery. Records contain an extension credential, never the IAB key. */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { DISCOVERY_BASE_DIR, isPidAlive } from './relay-discovery.js'
import { isDesktopEndpoint, type DesktopEndpoint } from '../shared/desktop-connection.js'

export interface DesktopRecord extends DesktopEndpoint { pid: number }

export function desktopRegistryDir(baseDir = DISCOVERY_BASE_DIR): string {
  return path.join(baseDir, 'desktop-instances')
}

export function writeDesktopRecord(record: DesktopRecord, baseDir = DISCOVERY_BASE_DIR): void {
  if (!isDesktopEndpoint(record) || !Number.isInteger(record.pid) || record.pid < 1) {
    throw new Error('Invalid desktop connection record')
  }
  const dir = desktopRegistryDir(baseDir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${record.installationId}.json`)
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
  fs.renameSync(temporary, file)
}

export function readDesktopRecords(baseDir = DISCOVERY_BASE_DIR): DesktopRecord[] {
  const dir = desktopRegistryDir(baseDir)
  let files: string[]
  try { files = fs.readdirSync(dir) } catch { return [] }
  return files.filter(file => /^[a-f0-9]{32}\.json$/.test(file)).flatMap(file => {
    try {
      const full = path.join(dir, file)
      const stat = fs.lstatSync(full)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) return []
      if (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) return []
      const record: DesktopRecord = JSON.parse(fs.readFileSync(full, 'utf8'))
      return isDesktopEndpoint(record) && file === `${record.installationId}.json` &&
        Number.isInteger(record.pid) && isPidAlive(record.pid) ? [record] : []
    } catch { return [] }
  })
}

/** Authenticate the live process, not merely a reused PID or an open port. */
export async function desktopRecordIsLive(record: DesktopRecord): Promise<boolean> {
  try {
    const challenge = randomBytes(32).toString('hex')
    const response = await fetch(`http://127.0.0.1:${record.port}/desktop/identity?challenge=${challenge}`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) return false
    const identity = await response.json() as Partial<DesktopEndpoint> & { proof?: string }
    const expected = createHmac('sha256', record.extensionKey).update(challenge).digest('hex')
    return identity.protocol === record.protocol && identity.installationId === record.installationId &&
      identity.instanceId === record.instanceId && typeof identity.proof === 'string' &&
      identity.proof.length === expected.length && timingSafeEqual(Buffer.from(identity.proof), Buffer.from(expected))
  } catch { return false }
}

export async function liveDesktopRecords(baseDir = DISCOVERY_BASE_DIR): Promise<DesktopRecord[]> {
  const records = readDesktopRecords(baseDir)
  const live = await Promise.all(records.map(desktopRecordIsLive))
  return records.filter((_, index) => live[index])
}

export function removeDesktopRecord(record: DesktopRecord, baseDir = DISCOVERY_BASE_DIR): void {
  const file = path.join(desktopRegistryDir(baseDir), `${record.installationId}.json`)
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8')) as DesktopRecord
    if (current.instanceId === record.instanceId) fs.unlinkSync(file)
  } catch { /* A later launch or a removed record is not ours to change. */ }
}
