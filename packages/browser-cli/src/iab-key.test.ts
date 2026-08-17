import { describe, expect, it } from 'vitest'

import { iabKeyFromEnv, PENGUIN_IAB_KEY_ENV } from './iab-key.js'

describe('IAB key environment handoff', () => {
  it('keeps the endpoint closed when the key is absent or empty', () => {
    expect(iabKeyFromEnv({})).toBeUndefined()
    expect(iabKeyFromEnv({ [PENGUIN_IAB_KEY_ENV]: '' })).toBeUndefined()
  })

  it('passes the key through exactly as written', () => {
    expect(iabKeyFromEnv({ [PENGUIN_IAB_KEY_ENV]: '  opaque-key  ' })).toBe('  opaque-key  ')
  })
})
