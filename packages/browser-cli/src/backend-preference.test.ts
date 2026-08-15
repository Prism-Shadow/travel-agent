/**
 * The per-conversation browser backend preference (relay-discovery.ts).
 *
 * How a choice made in the desktop shell reaches the CLI, which is a different process started
 * later by the agent. The property that matters is isolation: two conversations can legitimately
 * want different browsers, and a global setting would make changing either one change both.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BACKEND_PREFERENCE_VERSION,
  MAX_BACKEND_PREFERENCES,
  backendPreferencePath,
  readAllBackendPreferences,
  readBackendPreference,
  writeBackendPreference,
} from './relay-discovery.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iab-backend-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('readBackendPreference', () => {
  it('is null when nothing has been chosen', () => {
    // Not `iab`: "no preference" means the caller's default applies, and that default differs
    // between the desktop shell and a plain web deployment where there is no in-app browser at all.
    expect(readBackendPreference('session-1', tempDir())).toBeNull()
  })

  it('round-trips a choice', () => {
    const dir = tempDir()
    writeBackendPreference('session-1', 'extension', dir)
    expect(readBackendPreference('session-1', dir)).toBe('extension')
  })

  it('keeps conversations apart', () => {
    const dir = tempDir()
    writeBackendPreference('session-1', 'extension', dir)
    writeBackendPreference('session-2', 'iab', dir)
    expect(readBackendPreference('session-1', dir)).toBe('extension')
    expect(readBackendPreference('session-2', dir)).toBe('iab')
  })

  it("replaces one conversation's choice without touching another", () => {
    const dir = tempDir()
    writeBackendPreference('session-1', 'extension', dir)
    writeBackendPreference('session-2', 'extension', dir)
    writeBackendPreference('session-1', 'iab', dir)
    expect(readBackendPreference('session-1', dir)).toBe('iab')
    expect(readBackendPreference('session-2', dir)).toBe('extension')
  })

  it('writes the file readable only by its owner', () => {
    const dir = tempDir()
    writeBackendPreference('session-1', 'iab', dir)
    const mode = fs.statSync(backendPreferencePath(dir)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it.each([
    ['unparseable', 'not json'],
    ['a different version', JSON.stringify({ version: 99, backends: { 'session-1': 'iab' } })],
    ['the wrong shape', JSON.stringify({ version: BACKEND_PREFERENCE_VERSION, backends: 'iab' })],
  ])('reads %s as no preference rather than throwing', (_label, contents) => {
    // This file must never be able to stop a session starting.
    const dir = tempDir()
    fs.writeFileSync(backendPreferencePath(dir), contents)
    expect(readBackendPreference('session-1', dir)).toBeNull()
  })

  it('drops an entry naming a backend it does not recognise', () => {
    const dir = tempDir()
    fs.writeFileSync(
      backendPreferencePath(dir),
      JSON.stringify({
        version: BACKEND_PREFERENCE_VERSION,
        backends: { 'session-1': 'firefox', 'session-2': 'iab' },
      }),
    )
    expect(readBackendPreference('session-1', dir)).toBeNull()
    expect(readBackendPreference('session-2', dir)).toBe('iab')
  })

  it('prunes the oldest choices rather than growing without limit', () => {
    const dir = tempDir()
    for (let index = 0; index < MAX_BACKEND_PREFERENCES + 10; index += 1) {
      writeBackendPreference(`session-${index}`, 'extension', dir)
    }
    const all = readAllBackendPreferences(dir)
    expect(Object.keys(all)).toHaveLength(MAX_BACKEND_PREFERENCES)
    // Losing an old one costs that conversation the default, which is what it had before it chose.
    expect(all['session-0']).toBeUndefined()
    expect(all[`session-${MAX_BACKEND_PREFERENCES + 9}`]).toBe('extension')
  })

  it('ignores a blank session id instead of writing one', () => {
    const dir = tempDir()
    writeBackendPreference('', 'extension', dir)
    expect(readAllBackendPreferences(dir)).toEqual({})
  })
})
