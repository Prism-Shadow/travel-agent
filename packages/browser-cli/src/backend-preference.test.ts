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
  assertStandaloneBrowserModeAllowed,
  backendPreferencePath,
  readAllBackendPreferences,
  readBackendPreference,
  resolveBackendRequest,
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
    expect(writeBackendPreference('session-1', 'extension', dir)).toBe(true)
    expect(readBackendPreference('session-1', dir)).toBe('extension')
    expect(writeBackendPreference('session-1', 'iab', dir)).toBe(true)
    expect(readBackendPreference('session-1', dir)).toBe('iab')
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
    expect(writeBackendPreference('', 'extension', dir)).toBe(false)
    expect(readAllBackendPreferences(dir)).toEqual({})
  })

  it('reports a persistence failure instead of letting the UI claim success', () => {
    const blocked = path.join(tempDir(), 'not-a-directory')
    fs.writeFileSync(blocked, 'occupied')
    expect(writeBackendPreference('session-1', 'extension', blocked)).toBe(false)
    expect(readBackendPreference('session-1', blocked)).toBeNull()
  })
})

describe('resolveBackendRequest', () => {
  it('uses the recorded per-conversation choice in auto mode', () => {
    expect(resolveBackendRequest({ requested: 'auto', preference: 'iab' })).toBe('iab')
    expect(resolveBackendRequest({ requested: 'auto', preference: 'extension' })).toBe('extension')
  })

  it('keeps standalone and plain-web CLI use on the extension backend', () => {
    expect(resolveBackendRequest({ requested: 'auto', preference: null })).toBe('extension')
  })

  it('allows an explicit backend when no desktop conversation has recorded a choice', () => {
    expect(resolveBackendRequest({ requested: 'iab', preference: null })).toBe('iab')
    expect(resolveBackendRequest({ requested: 'extension', preference: null })).toBe('extension')
  })

  it('refuses overriding an IAB conversation from the CLI', () => {
    expect(() =>
      resolveBackendRequest({ requested: 'extension', preference: 'iab' }),
    ).toThrow(/set to use the in-app browser.*cannot be overridden/i)
  })

  it('refuses overriding a Chrome conversation from the CLI', () => {
    expect(() => resolveBackendRequest({ requested: 'iab', preference: 'extension' })).toThrow(
      /set to use your own Chrome.*cannot be overridden/i,
    )
  })

  it.each(['headless', 'cloud', 'direct'] as const)(
    'refuses %s mode when a Desktop conversation has a browser choice',
    (mode) => {
      expect(() => assertStandaloneBrowserModeAllowed('iab', mode)).toThrow(
        /desktop conversation.*cannot override/i,
      )
      expect(() => assertStandaloneBrowserModeAllowed('extension', mode)).toThrow(
        /desktop conversation.*cannot override/i,
      )
    },
  )

  it.each(['headless', 'cloud', 'direct'] as const)(
    'keeps standalone %s mode available without a Desktop preference',
    (mode) => {
      expect(() => assertStandaloneBrowserModeAllowed(null, mode)).not.toThrow()
    },
  )
})
