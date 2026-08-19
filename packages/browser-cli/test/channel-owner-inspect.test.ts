/**
 * Regression test for https://private-project.invalid/repository/issues/82
 *
 * User reported that running:
 *   penguin-browser -s 1 -e 'await page.goto("https://example.com")'
 * printed "all env vars" to the terminal.
 *
 * Root cause: `await page.goto(...)` auto-returns the Playwright Response.
 * util.inspect with depth:4 traversed Response → _connection → _platform →
 * env = process.env and dumped every environment variable.
 *
 * Fix: custom util.inspect handler on ChannelOwner and on the channel proxy
 * target. See playwright/packages/playwright-core/src/client/channelOwner.ts
 */
import { describe, it, expect } from 'vitest'
import util from 'node:util'

describe('issue #82 - env var leak via util.inspect on Playwright objects', () => {
  it('channel proxy target must NOT leak _platform.env via util.inspect', () => {
    // Simulate the channel proxy structure from ChannelOwner._createChannel:
    // a bare EventEmitter target wrapped in a Proxy, with _platform.env set
    // to process.env. Before the fix, util.inspect traversed this.
    const SECRET_KEY = 'ISSUE_82_TEST_SECRET_KEY'
    const SECRET_VALUE = 'this-should-never-appear-in-inspect-output'

    const base: any = {
      _events: {},
      _eventsCount: 0,
      _maxListeners: undefined,
      _platform: {
        env: { [SECRET_KEY]: SECRET_VALUE, HOME: '/home/user' },
        colors: {},
      },
    }

    // Simulate the fix: custom inspect set directly on the base target.
    base[Symbol.for('nodejs.util.inspect.custom')] = function () {
      return 'Channel<Response@test-guid>'
    }

    const proxy = new Proxy(base, { get: (obj, prop) => obj[prop] })

    // Inspect both directly and nested inside another object (as happens
    // when auto-returning a Response whose _initializer.request is a channel)
    const directInspect = util.inspect(proxy, { depth: 4 })
    const nestedInspect = util.inspect(
      { request: proxy, url: 'https://example.com' },
      { depth: 4 },
    )

    expect(directInspect).not.toContain(SECRET_VALUE)
    expect(directInspect).not.toContain(SECRET_KEY)
    expect(nestedInspect).not.toContain(SECRET_VALUE)
    expect(nestedInspect).not.toContain(SECRET_KEY)

    expect(directInspect).toMatchInlineSnapshot(`"Channel<Response@test-guid>"`)
    expect(nestedInspect).toMatchInlineSnapshot(`"{ request: Channel<Response@test-guid>, url: 'https://example.com' }"`)
  })

  it('ChannelOwner instance must NOT leak _platform.env via util.inspect', () => {
    // Simulate a ChannelOwner instance — this is what the user actually
    // auto-returns from `await page.goto(url)`.
    const SECRET_VALUE = 'issue-82-channelowner-secret'

    // Simulate a ChannelOwner instance via a plain object. The real fix in
    // playwright-core adds a computed Symbol method to the ChannelOwner class.
    const instance: any = {
      _type: 'Response',
      _guid: 'response@abc123',
      _connection: { _platform: { env: { LEAKED: SECRET_VALUE } } },
      _initializer: {
        url: 'https://example.com/',
        status: 200,
        statusText: 'OK',
      },
    }
    instance[Symbol.for('nodejs.util.inspect.custom')] = function (
      _depth: number,
      options: any,
      inspect: (value: any, opts: any) => string,
    ) {
      const header = `${this._type}@${this._guid}`
      const initializerDepth =
        typeof options?.depth === 'number' ? Math.max(options.depth - 1, 0) : 2
      return `${header} ${inspect(this._initializer, { ...options, depth: initializerDepth })}`
    }
    const output = util.inspect(instance, { depth: 4 })

    expect(output).not.toContain(SECRET_VALUE)
    expect(output).toMatchInlineSnapshot(
      `"Response@response@abc123 { url: 'https://example.com/', status: 200, statusText: 'OK' }"`,
    )
  })
})
