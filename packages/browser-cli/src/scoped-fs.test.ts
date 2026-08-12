/**
 * Regression tests for session-scoped filesystem resolution and session cwd reporting.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ExecutorManager, type SessionMetadata } from './executor.js'
import { createScopedFS } from './scoped-fs.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('ScopedFS', () => {
  test('resolves relative paths from the session cwd instead of the relay cwd', () => {
    const sessionDir = createTempDir('scoped-fs-session-')
    const relayDir = createTempDir('scoped-fs-relay-')
    const originalCwd = process.cwd()

    try {
      process.chdir(relayDir)

      const scopedFs = createScopedFS([sessionDir], sessionDir)
      scopedFs.writeFileSync('note.txt', 'hello from session')

      expect(fs.readFileSync(path.join(sessionDir, 'note.txt'), 'utf-8')).toBe('hello from session')
      expect(fs.existsSync(path.join(relayDir, 'note.txt'))).toBe(false)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(sessionDir, { recursive: true, force: true })
      fs.rmSync(relayDir, { recursive: true, force: true })
    }
  })
})

describe('ExecutorManager.listSessions', () => {
  test('includes the resolved cwd for each session', () => {
    const sessionDir = createTempDir('executor-session-')
    const sessionMetadata: SessionMetadata = {
      extensionId: 'profile:test',
      browser: 'Chrome',
      profile: { email: 'test@example.com', id: 'profile-1' },
    }

    try {
      const manager = new ExecutorManager({
        cdpConfig: { port: 19989 },
        logger: {
          log: () => {},
          error: () => {},
        },
      })

      manager.getExecutor({
        sessionId: '7',
        cwd: sessionDir,
        sessionMetadata,
      })

      expect(manager.listSessions()).toEqual([
        {
          id: '7',
          stateKeys: [],
          extensionId: 'profile:test',
          browser: 'Chrome',
          profile: { email: 'test@example.com', id: 'profile-1' },
          cwd: sessionDir,
        },
      ])
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true })
    }
  })
})
