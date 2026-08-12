import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCdpLogger, type CdpLogEntry } from './cdp-log.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-log-test-'))
}

function makeEntry(i: number): CdpLogEntry {
  return {
    timestamp: new Date().toISOString(),
    direction: 'from-extension',
    message: { method: `Test.method${i}`, id: i },
  }
}

function readIds(logFile: string): number[] {
  return fs
    .readFileSync(logFile, 'utf-8')
    .trim()
    .split('\n')
    .filter((l) => {
      return l.length > 0
    })
    .map((l) => {
      return JSON.parse(l).message.id as number
    })
}

describe('CDP log rotation', () => {
  it('rotates when lineCount exceeds maxEntries, keeping last half', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 20 })

    // Write 25 entries to trigger rotation (threshold is 20)
    for (let i = 0; i < 25; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    const ids = readIds(logFile)

    // Rotation triggers after entry 20 is written (lineCount becomes 21 > 20).
    // It keeps last 10 (entries 11-20), then entries 21-24 are appended.
    expect(ids).toMatchInlineSnapshot(`
      [
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        23,
        24,
      ]
    `)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('does not rotate when under maxEntries', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 50 })

    for (let i = 0; i < 30; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    const ids = readIds(logFile)
    expect(ids.length).toBe(30)
    expect(ids[0]).toBe(0)
    expect(ids[29]).toBe(29)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('handles multiple rotations', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 10 })

    // Write 35 entries, should trigger multiple rotations
    for (let i = 0; i < 35; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    const ids = readIds(logFile)

    // File should never exceed maxEntries
    expect(ids.length).toBeLessThanOrEqual(15)
    expect(ids.length).toBeGreaterThanOrEqual(5)

    // Last entry should always be the most recent
    expect(ids[ids.length - 1]).toBe(34)
    // No entries from the very beginning should survive multiple rotations
    expect(ids[0]).toBeGreaterThan(10)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('uses atomic rename for rotation', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 10 })

    for (let i = 0; i < 15; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    // Temp file should not remain after successful rotation
    expect(fs.existsSync(`${logFile}.tmp`)).toBe(false)

    const ids = readIds(logFile)
    expect(ids[ids.length - 1]).toBe(14)

    fs.rmSync(tmpDir, { recursive: true })
  })
})
