/**
 * What an executed snippet can see of the process it runs in.
 *
 * This is 003 §12's A8 and its neighbours, as unit tests: the dynamic-import escape is gone, and
 * `process` is an allowlist rather than three intercepted methods. Neither turns the vm into a
 * security boundary — Node says it is not one, and the agent has a shell elsewhere — but the
 * *sanctioned* path no longer hands out the environment, and the module allowlist means what it
 * says again.
 */
import { describe, expect, it } from 'vitest'

import { allowedEnvKeys, sandboxedProcess } from './sandboxed-process.js'

const sandbox = () => sandboxedProcess({ cwd: () => '/session/cwd' })

describe('process inside the sandbox', () => {
  it('answers cwd with the session directory, not the relay one', () => {
    expect((sandbox().cwd as () => string)()).toBe('/session/cwd')
  })

  it.each(['exit', 'abort', 'chdir', 'kill', 'binding', 'dlopen'])('refuses %s', (name) => {
    expect(() => (sandbox()[name] as () => void)()).toThrow(/not available in the sandbox/)
  })

  it('does not hand over the environment', () => {
    // The one that matters. This turn's interaction credential and the user's vault entries are in
    // the real environment, and code assembled from a web page has no business reading either.
    const previous = process.env.PENGUIN_INTERACTION_TOKEN
    process.env.PENGUIN_INTERACTION_TOKEN = 'secret-token'
    try {
      const env = sandbox().env as Record<string, string>
      expect(env.PENGUIN_INTERACTION_TOKEN).toBeUndefined()
      expect(Object.keys(env).every((key) => allowedEnvKeys().includes(key))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.PENGUIN_INTERACTION_TOKEN
      else process.env.PENGUIN_INTERACTION_TOKEN = previous
    }
  })

  it('keeps the few variables that describe the machine rather than authenticate to it', () => {
    const previous = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    try {
      expect((sandbox().env as Record<string, string>).TZ).toBe('Asia/Shanghai')
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('cannot be written back into the real environment', () => {
    const env = sandbox().env as Record<string, string>
    expect(() => {
      'use strict'
      ;(env as Record<string, string>).LANG = 'tampered'
    }).toThrow()
    expect(process.env.LANG).not.toBe('tampered')
  })

  it('is not a proxy over the real process, so nothing leads back to it', () => {
    // A Proxy would still carry the target's identity: one prototype walk and the whole object is
    // back. This is a plain object with a fixed set of answers.
    const sandboxed = sandbox()
    expect(Object.getPrototypeOf(sandboxed)).toBe(Object.prototype)
    expect((sandboxed as { argv?: unknown }).argv).toBeUndefined()
    expect((sandboxed as { execPath?: unknown }).execPath).toBeUndefined()
    expect((sandboxed as { mainModule?: unknown }).mainModule).toBeUndefined()
  })
})
