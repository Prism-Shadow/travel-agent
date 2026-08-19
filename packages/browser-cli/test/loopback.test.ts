/**
 * `isLoopbackAddress` (utils.ts): the predicate guarding the `/iab` endpoint.
 *
 * Tested exhaustively rather than by inspection because both directions of failure are real. Read
 * `::ffff:127.0.0.1` as remote and the endpoint breaks on any dual-stack host, where that is simply
 * how a v4 client is reported. Read `127.0.0.1.evil.com` as local and the whole restriction is a
 * formality.
 */
import { describe, expect, it } from 'vitest'
import { isLoopbackAddress } from '../src/shared/utils.js'

describe('accepts loopback in every shape it arrives in', () => {
  it.each([
    ['IPv4', '127.0.0.1'],
    ['IPv6', '::1'],
    ['IPv6 in brackets', '[::1]'],
    ['IPv4-mapped IPv6', '::ffff:127.0.0.1'],
    ['uppercase IPv4-mapped', '::FFFF:127.0.0.1'],
    ['elsewhere in 127/8', '127.1.2.3'],
    ['the top of 127/8', '127.255.255.255'],
    ['surrounding whitespace', '  127.0.0.1  '],
  ])('%s', (_label, address) => {
    expect(isLoopbackAddress(address)).toBe(true)
  })
})

describe('refuses everything else', () => {
  it.each([
    ['a LAN address', '192.168.1.10'],
    ['a public address', '203.0.113.7'],
    ['the unspecified address', '0.0.0.0'],
    ['IPv6 unspecified', '::'],
    ['a public IPv6', '2001:db8::1'],
    ['an IPv4-mapped LAN address', '::ffff:192.168.1.10'],
    ['a hostname that merely starts with it', '127.0.0.1.evil.com'],
    ['a hostname containing it', 'evil-127.0.0.1.example'],
    ['the adjacent block', '128.0.0.1'],
    ['an octet out of range', '127.0.0.256'],
    ['too few octets', '127.0.1'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('%s', (_label, address) => {
    expect(isLoopbackAddress(address)).toBe(false)
  })

  it('refuses a missing address — an unknown peer is not a local one', () => {
    expect(isLoopbackAddress(undefined)).toBe(false)
    expect(isLoopbackAddress(null)).toBe(false)
  })
})
