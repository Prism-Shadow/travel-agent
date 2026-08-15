/**
 * What one conversation's Playwright client may see and do on the shared in-app browser backend.
 *
 * One desktop shell serves every conversation over a single `/iab` socket, so the relay is the only
 * place that can keep them apart. Every test here runs two conversations at once, because that is
 * the only configuration in which the interesting failures exist: a root command that names another
 * conversation's target, an answer that falls back to "the first page we know about", a download
 * path applied as the wrong task, an event delivered to a client that should never have heard of
 * that page.
 *
 * No Chromium. The backend is a double that speaks the shell's half of the protocol — announcing
 * targets with their owners, answering forwarded commands, refusing what the real shell refuses —
 * which is exactly the surface the relay's scoping logic reads.
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createCdpLogger } from './cdp-log.js'
import { startPenguinBrowserCDPRelayServer } from './cdp-relay.js'
import { EXTENSION_IDS, IAB_BACKEND_ID } from './utils.js'

const IAB_KEY = 'iab-scope-test-key'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

let port: number
let logDir: string
let server: Awaited<ReturnType<typeof startPenguinBrowserCDPRelayServer>>

/** One forwarded command, as the shell sees it. */
interface Forwarded {
  id: number
  method: string
  params: Record<string, unknown>
}

/** The desktop shell's half of the `/iab` protocol, scripted. */
class BackendDouble {
  readonly received: Forwarded[] = []
  /** Methods the shell should answer with an error, by name. */
  readonly refuse = new Map<string, string>()
  private socket: WebSocket | null = null

  constructor(
    private readonly options: { path: string; id: string; installId: string; origin?: string } = {
      path: `/iab?key=${IAB_KEY}`,
      id: IAB_BACKEND_ID,
      installId: 'iab-1',
    },
  ) {}

  async connect(): Promise<void> {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}${this.options.path}&id=${this.options.id}&browser=travel-agent` +
        `&installId=${this.options.installId}&v=1`,
      // Only the extension endpoint asks for one, and only from the extension's own origin; the
      // `/iab` endpoint refuses any Origin at all, which is why this is per-backend.
      this.options.origin ? { headers: { origin: this.options.origin } } : {},
    )
    this.socket = socket
    socket.on('error', () => {})
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('close', () => reject(new Error('the backend socket closed')))
    })
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { id?: number; method?: string; params?: unknown }
      if (message.method === 'ping') {
        socket.send(JSON.stringify({ method: 'pong' }))
        return
      }
      if (typeof message.id !== 'number') return
      const params = (message.params ?? {}) as Record<string, unknown>
      this.received.push({ id: message.id, method: String(message.method), params })
      const inner = typeof params.method === 'string' ? params.method : String(message.method)
      const refusal = this.refuse.get(inner)
      if (refusal) {
        // A string, which is how the shell states a refusal.
        socket.send(JSON.stringify({ id: message.id, error: refusal }))
        return
      }
      socket.send(JSON.stringify({ id: message.id, result: { ok: true, echoed: inner } }))
    })
  }

  /** Announces a tab, with the shell's statement of who holds it. */
  announce(target: {
    sessionId: string
    targetId: string
    url: string
    owner: { sessionScope: string; taskId: string | null; relaySessionId: string | null }
  }): void {
    this.socket?.send(
      JSON.stringify({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: target.sessionId,
            targetInfo: {
              targetId: target.targetId,
              type: 'page',
              title: target.url,
              url: target.url,
              attached: true,
            },
            waitingForDebugger: false,
          },
          iabOwner: target.owner.taskId
            ? {
                sessionScope: target.owner.sessionScope,
                taskId: target.owner.taskId,
                relaySessionId: target.owner.relaySessionId,
              }
            : { sessionScope: target.owner.sessionScope },
        },
      }),
    )
  }

  /** An ordinary page event, routed by CDP session the way every non-target event is. */
  emit(sessionId: string, method: string, params: Record<string, unknown> = {}): void {
    this.socket?.send(
      JSON.stringify({ method: 'forwardCDPEvent', params: { method, params, sessionId } }),
    )
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }
}

/** A Playwright-shaped client bound to one conversation, task and relay session. */
class ClientDouble {
  readonly events: Array<{ method: string; sessionId?: string; params?: unknown }> = []
  private socket: WebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  constructor(
    private readonly identity: {
      clientId: string
      iabSession?: string
      iabTask?: string
      iabRelaySession?: string
      extensionId?: string
    },
  ) {}

  async connect(): Promise<void> {
    const query = new URLSearchParams()
    if (this.identity.iabSession) query.set('iabSession', this.identity.iabSession)
    if (this.identity.iabTask) query.set('iabTask', this.identity.iabTask)
    if (this.identity.iabRelaySession) query.set('iabRelaySession', this.identity.iabRelaySession)
    // Bound explicitly: the relay deliberately keeps the in-app browser backend out of the "pick
    // whatever is connected" fallback, so an in-app browser client always names it.
    query.set('extensionId', this.identity.extensionId ?? 'install:iab-1')
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/cdp/${this.identity.clientId}?${query.toString()}`,
    )
    this.socket = socket
    socket.on('error', () => {})
    // A client the relay will not have is closed *after* the upgrade, with a code that says why —
    // so waiting for "open" alone would call a refusal a success and then time out on every
    // command. Both outcomes are watched, and the refusal is given a moment to arrive.
    await new Promise<void>((resolve, reject) => {
      let settled = false
      socket.once('close', (code: number) => {
        settled = true
        reject(new Error(`refused with ${code}`))
      })
      socket.once('open', () => {
        setTimeout(() => {
          if (!settled) resolve()
        }, 50)
      })
    })
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: number
        result?: unknown
        error?: { message?: string }
        method?: string
        sessionId?: string
        params?: unknown
      }
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id)!
        this.pending.delete(message.id)
        if (message.error) waiter.reject(new Error(message.error.message ?? 'error'))
        else waiter.resolve(message.result)
        return
      }
      if (message.method) {
        this.events.push({
          method: message.method,
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          params: message.params,
        })
      }
    })
  }

  send(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket?.send(
        JSON.stringify({ id, method, ...(params === undefined ? {} : { params }), ...(sessionId ? { sessionId } : {}) }),
      )
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timed out waiting for ${method}`))
      }, 5000)
    })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }
}

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let backend: BackendDouble
const clients: ClientDouble[] = []

async function client(identity: {
  clientId: string
  iabSession?: string
  iabTask?: string
  iabRelaySession?: string
  extensionId?: string
}): Promise<ClientDouble> {
  const created = new ClientDouble(identity)
  await created.connect()
  clients.push(created)
  return created
}

beforeAll(async () => {
  port = await freePort()
  // Its own CDP log. The default path is a *shared* file that `createCdpLogger` truncates on
  // creation, so a relay started here wipes the log another suite is in the middle of measuring —
  // which is how this file, on its first run, turned a passing download-events assertion in
  // `relay-core.test.ts` into a mystery.
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iab-scope-log-'))
  server = await startPenguinBrowserCDPRelayServer({
    port,
    host: '127.0.0.1',
    iabKey: IAB_KEY,
    cdpLogger: createCdpLogger({ logFilePath: path.join(logDir, 'cdp.jsonl') }),
  })
}, 30000)

afterAll(async () => {
  backend?.close()
  for (const open of clients) open.close()
  await server?.close?.()
  if (logDir) fs.rmSync(logDir, { recursive: true, force: true })
})

beforeEach(async () => {
  for (const open of clients.splice(0)) open.close()
  backend?.close()
  backend = new BackendDouble()
  await backend.connect()
  // Conversation A holds one tab owned by task-a; conversation B holds one owned by task-b.
  backend.announce({
    sessionId: 'cdp-a',
    targetId: 'target-a',
    url: 'https://a.example/',
    owner: { sessionScope: 'session-a', taskId: 'task-a', relaySessionId: 'relay-a' },
  })
  backend.announce({
    sessionId: 'cdp-b',
    targetId: 'target-b',
    url: 'https://b.example/',
    owner: { sessionScope: 'session-b', taskId: 'task-b', relaySessionId: 'relay-b' },
  })
  await settle()
})

describe('what a conversation can see', () => {
  it('lists only its own targets', async () => {
    const a = await client({
      clientId: 'a-1',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    const result = (await a.send('Target.getTargets')) as { targetInfos: Array<{ targetId: string }> }
    expect(result.targetInfos.map((info) => info.targetId)).toEqual(['target-a'])
  })

  it('refuses to describe another conversation’s target instead of answering about its own', async () => {
    // The fallback that made this a disclosure: an unknown target id fell through to "the first
    // target this client can see", so a client asking about `target-b` was told about `target-a` —
    // its URL, its title — and then addressed it as though it were the page it named.
    const a = await client({
      clientId: 'a-2',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(a.send('Target.getTargetInfo', { targetId: 'target-b' })).rejects.toThrow(
      /No such target in this conversation/,
    )
  })

  it('answers about its own target by id', async () => {
    const a = await client({
      clientId: 'a-3',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    const result = (await a.send('Target.getTargetInfo', { targetId: 'target-a' })) as {
      targetInfo: { url: string }
    }
    expect(result.targetInfo.url).toBe('https://a.example/')
  })

  it('refuses a CDP session belonging to another conversation', async () => {
    const a = await client({
      clientId: 'a-4',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(a.send('Runtime.evaluate', { expression: '1' }, 'cdp-b')).rejects.toThrow(
      /No such target session in this conversation/,
    )
    expect(backend.received.some((entry) => entry.params.sessionId === 'cdp-b')).toBe(false)
  })

  it('never delivers another conversation’s page events', async () => {
    const a = await client({
      clientId: 'a-5',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    backend.emit('cdp-b', 'Page.frameNavigated', { frame: { url: 'https://b.example/secret' } })
    backend.emit('cdp-a', 'Page.frameNavigated', { frame: { url: 'https://a.example/next' } })
    await settle()

    const navigations = a.events.filter((event) => event.method === 'Page.frameNavigated')
    expect(navigations).toHaveLength(1)
    expect(navigations[0]?.sessionId).toBe('cdp-a')
  })
})

describe('root commands that name a target', () => {
  const rootCommands: Array<[string, Record<string, unknown>]> = [
    ['Target.closeTarget', { targetId: 'target-b' }],
    ['Target.activateTarget', { targetId: 'target-b' }],
    ['Target.attachToTarget', { targetId: 'target-b' }],
    ['Target.exposeDevToolsProtocol', { targetId: 'target-b' }],
    ['Target.detachFromTarget', { sessionId: 'cdp-b' }],
    ['Target.sendMessageToTarget', { sessionId: 'cdp-b', message: '{"id":1,"method":"Page.reload"}' }],
  ]

  it.each(rootCommands)('refuses %s aimed at another conversation', async (method, params) => {
    // Each of these names what it acts on in its parameters rather than being *sent* to it, so the
    // shell's per-tab ownership check never sees them. Only the relay can refuse them, and the
    // first version special-cased `closeTarget` alone — which is how the other five were missed.
    const a = await client({
      clientId: `root-${method}`,
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(a.send(method, params)).rejects.toThrow(/in this conversation/)
    expect(backend.received.some((entry) => JSON.stringify(entry.params).includes('target-b'))).toBe(
      false,
    )
    expect(backend.received.some((entry) => JSON.stringify(entry.params).includes('cdp-b'))).toBe(
      false,
    )
  })

  it('allows the same commands against its own target', async () => {
    const a = await client({
      clientId: 'root-own',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(a.send('Target.activateTarget', { targetId: 'target-a' })).resolves.toBeTruthy()
    const forwarded = backend.received.filter(
      (entry) => (entry.params as { method?: string }).method === 'Target.activateTarget',
    )
    expect(forwarded).toHaveLength(1)
    // And it carries the caller's task, so the shell's ownership gate can see who is asking.
    expect(forwarded[0]?.params.taskId).toBe('task-a')
  })

  it('leaves an unscoped client alone', async () => {
    // Extension and direct clients connect to a browser that has no notion of a conversation. The
    // scoping must not start refusing their root commands, and it must not start requiring an
    // identity of a client that has nowhere to get one.
    const chrome = new BackendDouble({
      path: '/extension?',
      id: 'chrome-ext',
      installId: 'ext-1',
      origin: `chrome-extension://${EXTENSION_IDS[0]}`,
    })
    await chrome.connect()
    chrome.announce({
      sessionId: 'cdp-x',
      targetId: 'target-x',
      url: 'https://x.example/',
      owner: { sessionScope: 'session-x', taskId: null, relaySessionId: null },
    })
    await settle()
    try {
      const direct = await client({ clientId: 'direct-1', extensionId: 'install:ext-1' })
      const result = (await direct.send('Target.getTargets')) as {
        targetInfos: Array<{ targetId: string }>
      }
      expect(result.targetInfos.map((info) => info.targetId)).toEqual(['target-x'])
      await expect(direct.send('Target.activateTarget', { targetId: 'target-x' })).resolves.toBeTruthy()
    } finally {
      chrome.close()
    }
  })
})

describe('tab creation and claiming', () => {
  it('builds the identity from the socket, not from the caller’s parameters', async () => {
    const a = await client({
      clientId: 'open-1',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await a.send('iab-open-tab', { url: 'https://a.example/next' })

    const opened = backend.received.find((entry) => entry.method === 'iab-open-tab')
    expect(opened?.params).toMatchObject({
      url: 'https://a.example/next',
      sessionId: 'session-a',
      taskId: 'task-a',
      relaySessionId: 'relay-a',
    })
  })

  it('refuses a client that names another conversation’s live task', async () => {
    // The forgery: the two shell commands took their identity from the CDP parameters, so client A
    // could open tabs as `session-b`/`task-b` — and the shell's "is that task live?" check *passed*,
    // because the task named genuinely was running. The shell cannot catch this; it is being told a
    // true fact by the wrong party.
    const a = await client({
      clientId: 'open-2',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(
      a.send('iab-open-tab', {
        url: 'https://b.example/steal',
        sessionId: 'session-b',
        taskId: 'task-b',
        relaySessionId: 'relay-b',
      }),
    ).rejects.toThrow(/does not hold/)
    expect(backend.received.some((entry) => entry.method === 'iab-open-tab')).toBe(false)
  })

  it('refuses a claim that names another conversation’s relay session', async () => {
    const a = await client({
      clientId: 'claim-1',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(
      a.send('iab-claim-tab', { targetId: 'target-a', relaySessionId: 'relay-b' }),
    ).rejects.toThrow(/does not hold/)
    expect(backend.received.some((entry) => entry.method === 'iab-claim-tab')).toBe(false)
  })

  it('refuses a claim on a target in another conversation', async () => {
    const a = await client({
      clientId: 'claim-2',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(a.send('iab-claim-tab', { targetId: 'target-b' })).rejects.toThrow(
      /No such target in this conversation/,
    )
  })

  it('stamps a claim of its own tab with the bound identity', async () => {
    const a = await client({
      clientId: 'claim-3',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await a.send('iab-claim-tab', { targetId: 'target-a' })
    const claim = backend.received.find((entry) => entry.method === 'iab-claim-tab')
    expect(claim?.params).toMatchObject({
      targetId: 'target-a',
      sessionId: 'session-a',
      taskId: 'task-a',
      relaySessionId: 'relay-a',
    })
  })

  it('accepts the executor’s own claim, which states the identity it already holds', async () => {
    // The executor sends all four parameters, and its `sessionId` is a *conversation* — not a CDP
    // session. Running these two commands through the generic CDP validator read it as one and
    // refused every legitimate claim, which no test caught because the fixtures were sending the
    // shorter form.
    backend.announce({
      sessionId: 'cdp-a-retained',
      targetId: 'target-a-retained',
      url: 'https://a.example/retained',
      owner: { sessionScope: 'session-a', taskId: null, relaySessionId: null },
    })
    await settle()

    const a = await client({
      clientId: 'claim-4',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(
      a.send('iab-claim-tab', {
        targetId: 'target-a-retained',
        sessionId: 'session-a',
        taskId: 'task-a',
        relaySessionId: 'relay-a',
      }),
    ).resolves.toBeTruthy()

    const claim = backend.received.find((entry) => entry.method === 'iab-claim-tab')
    expect(claim?.params).toMatchObject({
      targetId: 'target-a-retained',
      sessionId: 'session-a',
      taskId: 'task-a',
      relaySessionId: 'relay-a',
    })
  })

  it('accepts the executor’s own open, which states the same', async () => {
    const a = await client({
      clientId: 'open-3',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(
      a.send('iab-open-tab', {
        url: 'https://a.example/next',
        sessionId: 'session-a',
        taskId: 'task-a',
        relaySessionId: 'relay-a',
      }),
    ).resolves.toBeTruthy()
  })

  it.each([
    ['conversation', { sessionId: 'session-b' }],
    ['task', { taskId: 'task-b' }],
    ['relay session', { relaySessionId: 'relay-b' }],
  ])('refuses a claim that names another %s', async (_label, forged) => {
    const a = await client({
      clientId: `claim-forge-${_label}`,
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(
      a.send('iab-claim-tab', {
        targetId: 'target-a',
        sessionId: 'session-a',
        taskId: 'task-a',
        relaySessionId: 'relay-a',
        ...forged,
      }),
    ).rejects.toThrow(/does not hold/)
    expect(backend.received.some((entry) => entry.method === 'iab-claim-tab')).toBe(false)
  })

  it('refuses a claim with no target at all', async () => {
    const a = await client({
      clientId: 'claim-5',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(a.send('iab-claim-tab', {})).rejects.toThrow(/needs the target id/)
  })

  it('refuses an in-app browser client that does not say which relay session it is', async () => {
    await expect(
      client({ clientId: 'no-relay', iabSession: 'session-a', iabTask: 'task-a' }),
    ).rejects.toThrow(/refused with 4003/)
  })
})

describe('download behaviour', () => {
  it('applies only to the pages the asking task owns', async () => {
    // Keyed by conversation alone, one task's download path was pushed at every tab in the
    // conversation — released ones and other turns' alike — as *that* task, which the shell then
    // refused. Half-applied and silently broken.
    backend.announce({
      sessionId: 'cdp-a2',
      targetId: 'target-a2',
      url: 'https://a.example/released',
      owner: { sessionScope: 'session-a', taskId: null, relaySessionId: null },
    })
    await settle()

    const a = await client({
      clientId: 'dl-1',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await a.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/a' })

    const applied = backend.received.filter(
      (entry) => (entry.params as { method?: string }).method === 'Page.setDownloadBehavior',
    )
    expect(applied.map((entry) => entry.params.sessionId)).toEqual(['cdp-a'])
    expect(applied[0]?.params.taskId).toBe('task-a')
  })

  it('tells the caller when the shell refused it', async () => {
    // Swallowed, this looks like a working `setDownloadBehavior` until a file goes missing: the
    // download quietly keeps going to the default directory and the executor never hears about it.
    backend.refuse.set('Page.setDownloadBehavior', 'IAB_TAB_FOREIGN: that page belongs to task-x')
    const a = await client({
      clientId: 'dl-2',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await expect(
      a.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/a' }),
    ).rejects.toThrow(/IAB_TAB_FOREIGN/)
  })

  it('replays a new page’s behaviour as its own owner, and not across conversations', async () => {
    const a = await client({
      clientId: 'dl-3',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    const b = await client({
      clientId: 'dl-4',
      iabSession: 'session-b',
      iabTask: 'task-b',
      iabRelaySession: 'relay-b',
    })
    await a.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/a' })
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/b' })
    backend.received.length = 0

    // A second tab for task-a, and one for task-b, each announced the way the shell announces them.
    backend.announce({
      sessionId: 'cdp-a3',
      targetId: 'target-a3',
      url: 'https://a.example/two',
      owner: { sessionScope: 'session-a', taskId: 'task-a', relaySessionId: 'relay-a' },
    })
    backend.announce({
      sessionId: 'cdp-b3',
      targetId: 'target-b3',
      url: 'https://b.example/two',
      owner: { sessionScope: 'session-b', taskId: 'task-b', relaySessionId: 'relay-b' },
    })
    await settle()

    const replays = backend.received.filter(
      (entry) => (entry.params as { method?: string }).method === 'Page.setDownloadBehavior',
    )
    const bySession = new Map(replays.map((entry) => [entry.params.sessionId, entry.params]))
    expect(bySession.get('cdp-a3')).toMatchObject({
      taskId: 'task-a',
      params: { behavior: 'allow', downloadPath: '/tmp/a' },
    })
    expect(bySession.get('cdp-b3')).toMatchObject({
      taskId: 'task-b',
      params: { behavior: 'allow', downloadPath: '/tmp/b' },
    })
  })

  it('gives a released tab nobody’s download path', async () => {
    // The turn whose path it would inherit is over, and the page belongs to the user now.
    const a = await client({
      clientId: 'dl-5',
      iabSession: 'session-a',
      iabTask: 'task-a',
      iabRelaySession: 'relay-a',
    })
    await a.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/a' })
    backend.received.length = 0

    backend.announce({
      sessionId: 'cdp-a4',
      targetId: 'target-a4',
      url: 'https://a.example/released',
      owner: { sessionScope: 'session-a', taskId: null, relaySessionId: null },
    })
    await settle()

    expect(
      backend.received.some(
        (entry) => (entry.params as { method?: string }).method === 'Page.setDownloadBehavior',
      ),
    ).toBe(false)
  })
})
