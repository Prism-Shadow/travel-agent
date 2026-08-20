import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRelayServerEntryPath } from '../src/relay/relay-client.js'

describe('relay server entry resolution', () => {
  it('resolves the source entry from the package root', () => {
    expect(getRelayServerEntryPath('/workspace/src/relay/relay-client.ts', '/workspace')).toBe(
      path.join('/workspace', 'src', 'start-relay-server.ts'),
    )
  })

  it('resolves the compiled entry from the package root', () => {
    expect(getRelayServerEntryPath('/workspace/dist/relay/relay-client.js', '/workspace')).toBe(
      path.join('/workspace', 'dist', 'start-relay-server.js'),
    )
  })
})
