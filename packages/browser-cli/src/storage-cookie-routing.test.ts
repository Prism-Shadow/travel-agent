import { describe, expect, it } from 'vitest'
import {
  assertStorageCookiesAreAuthorized,
  getAuthorizedCookieUrls,
  selectStorageCookieRoutingTarget,
  type StorageCookieRoutingTarget,
} from './storage-cookie-routing.js'

function target(
  sessionId: string,
  options: { type?: string; url?: string; browserContextId?: string } = {},
): StorageCookieRoutingTarget {
  return {
    sessionId,
    targetInfo: {
      type: options.type ?? 'page',
      ...(options.url ? { url: options.url } : {}),
      ...(options.browserContextId ? { browserContextId: options.browserContextId } : {}),
    },
  }
}

describe('root Storage cookie routing', () => {
  it('selects a deterministic page in the default context when multiple targets exist', () => {
    const selected = selectStorageCookieRoutingTarget({
      connectedTargets: [
        target('iframe', { type: 'iframe' }),
        target('incognito', { browserContextId: 'incognito-context' }),
        target('default-first'),
        target('default-second'),
      ],
    })

    expect(selected.sessionId).toBe('default-first')
  })

  it('treats one opaque context as the default persistent profile', () => {
    const selected = selectStorageCookieRoutingTarget({
      connectedTargets: [
        target('persistent-first', { browserContextId: 'opaque-persistent-context' }),
        target('persistent-second', { browserContextId: 'opaque-persistent-context' }),
      ],
    })

    expect(selected.sessionId).toBe('persistent-first')
  })

  it('selects only a page in the explicitly requested browser context', () => {
    const selected = selectStorageCookieRoutingTarget({
      connectedTargets: [target('default'), target('context-a', { browserContextId: 'context-a' })],
      browserContextId: 'context-a',
    })

    expect(selected.sessionId).toBe('context-a')
  })

  it('does not fall back across browser contexts', () => {
    expect(() => {
      selectStorageCookieRoutingTarget({
        connectedTargets: [target('default'), target('context-b', { browserContextId: 'context-b' })],
        browserContextId: 'context-a',
      })
    }).toThrow('No authorized page target is attached for browser context context-a')
  })

  it('does not guess a default target across multiple opaque contexts', () => {
    expect(() => {
      selectStorageCookieRoutingTarget({
        connectedTargets: [
          target('context-a', { browserContextId: 'context-a' }),
          target('context-b', { browserContextId: 'context-b' }),
        ],
      })
    }).toThrow('Root Storage cookie command is ambiguous across multiple browser contexts')
  })

  it('collects only authorized HTTP URLs in the selected browser context', () => {
    const selected = target('context-a-page', {
      browserContextId: 'context-a',
      url: 'https://a.example.com/path',
    })
    expect(
      getAuthorizedCookieUrls({
        selectedTarget: selected,
        connectedTargets: [
          selected,
          target('context-a-second', { browserContextId: 'context-a', url: 'http://b.example.com/' }),
          target('context-b', { browserContextId: 'context-b', url: 'https://private.example.net/' }),
          target('blank', { browserContextId: 'context-a', url: 'about:blank' }),
        ],
      }),
    ).toEqual(['https://a.example.com/path', 'http://b.example.com/'])
  })

  it('allows cookies scoped to an authorized host or parent domain', () => {
    expect(() => {
      assertStorageCookiesAreAuthorized({
        authorizedUrls: ['https://app.example.com/account'],
        cookies: [
          { name: 'host-cookie', url: 'https://app.example.com/' },
          { name: 'domain-cookie', domain: '.example.com' },
        ],
      })
    }).not.toThrow()
  })

  it('rejects cookie writes for an unauthorized sibling host', () => {
    expect(() => {
      assertStorageCookiesAreAuthorized({
        authorizedUrls: ['https://app.example.com/account'],
        cookies: [{ name: 'private-cookie', url: 'https://admin.example.com/' }],
      })
    }).toThrow('Refusing to set cookie private-cookie for an unauthorized URL')
  })
})
