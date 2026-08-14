import { describe, expect, it } from 'vitest'
import { resolvePersistentInstallId } from '../src/install-identity.js'

describe('persistent extension installation identity', () => {
  it('returns a persisted installation id', async () => {
    await expect(resolvePersistentInstallId(async () => 'install-a')).resolves.toBe('install-a')
  })

  it('does not promote storage failure to an ephemeral persistent identity', async () => {
    await expect(
      resolvePersistentInstallId(async () => {
        throw new Error('storage unavailable')
      }),
    ).resolves.toBeNull()
  })
})
