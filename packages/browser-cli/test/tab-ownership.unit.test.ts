import { beforeEach, describe, expect, it } from 'vitest'
import {
  acquireAndNavigateOwnedTab,
  acquireOwnedTab,
  isReusableIabBootstrapTarget,
  selectReusableBlankTargetId,
  SerializedOwnedTabOpener,
  TabRegistry,
} from '../src/relay/tab-ownership.js'

let registry: TabRegistry

beforeEach(() => {
  registry = new TabRegistry()
})

describe('TabRegistry', () => {
  it('claims a free tab', () => {
    expect(registry.claim('t1', 's1')).toEqual({ ok: true, state: 'claimed' })
    expect(registry.ownerOf('t1')).toBe('s1')
  })

  it('re-claiming your own tab is a no-op, not an error', () => {
    registry.claim('t1', 's1')
    expect(registry.claim('t1', 's1')).toEqual({ ok: true, state: 'already_yours' })
  })

  // Never steal: last-writer-wins would turn a visible collision into a silent one, which is the
  // exact failure this exists to prevent — a second agent typing into someone's checkout page.
  it('refuses a tab another session holds, and names the holder', () => {
    registry.claim('t1', 's1')
    expect(registry.claim('t1', 's2')).toEqual({ ok: false, heldBy: 's1' })
    expect(registry.ownerOf('t1')).toBe('s1')
  })

  it('release frees the tab for others', () => {
    registry.claim('t1', 's1')
    expect(registry.release('t1', 's1')).toBe(true)
    expect(registry.claim('t1', 's2')).toEqual({ ok: true, state: 'claimed' })
  })

  it('a session cannot release a tab it does not hold', () => {
    registry.claim('t1', 's1')
    expect(registry.release('t1', 's2')).toBe(false)
    expect(registry.ownerOf('t1')).toBe('s1')
  })

  it('availability covers free tabs and your own, never someone else’s', () => {
    registry.claim('t1', 's1')
    expect(registry.isAvailableTo('t1', 's1')).toBe(true)
    expect(registry.isAvailableTo('t1', 's2')).toBe(false)
    expect(registry.isAvailableTo('t-free', 's2')).toBe(true)
  })

  // A crashed run must not strand tabs that nobody can release.
  it('releaseAll drops every claim a session holds and leaves others alone', () => {
    registry.claim('t1', 's1')
    registry.claim('t2', 's1')
    registry.claim('t3', 's2')
    expect(registry.releaseAll('s1')).toBe(2)
    expect(registry.ownerOf('t1')).toBeUndefined()
    expect(registry.ownerOf('t3')).toBe('s2')
  })

  it('claimsOf lists a session’s tabs', () => {
    registry.claim('t1', 's1')
    registry.claim('t2', 's2')
    registry.claim('t3', 's1')
    expect(registry.claimsOf('s1').sort()).toEqual(['t1', 't3'])
  })

  it('forget removes a closed tab regardless of holder', () => {
    registry.claim('t1', 's1')
    registry.forget('t1')
    expect(registry.ownerOf('t1')).toBeUndefined()
  })

  it('snapshot reports every claim', () => {
    registry.claim('t1', 's1')
    registry.claim('t2', 's2')
    expect(registry.snapshot()).toEqual({ t1: 's1', t2: 's2' })
  })

  // The scenario the whole module exists for: three sessions racing for one idle tab, which is
  // what the documented `context.pages().find(idle) ?? newPage()` idiom does when run in
  // parallel. Exactly one wins; the losers learn who holds it rather than proceeding.
  it('exactly one session wins a contested tab', () => {
    const outcomes = ['s1', 's2', 's3'].map((session) => registry.claim('idle-tab', session))
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    for (const outcome of outcomes.filter((o) => !o.ok)) {
      expect(outcome).toEqual({ ok: false, heldBy: 's1' })
    }
  })
})

describe('acquireOwnedTab', () => {
  it('returns a reusable tab only after claiming it', async () => {
    const claimed: string[] = []
    const tab = await acquireOwnedTab({
      findReusable: async () => 'blank',
      create: async () => 'created',
      claim: async (candidate) => {
        claimed.push(candidate)
        return true
      },
    })

    expect(tab).toEqual({ tab: 'blank', source: 'reused' })
    expect(claimed).toEqual(['blank'])
  })

  it('never returns or discards a freshly created tab when another session wins its claim', async () => {
    let reusableCalls = 0
    let created = 0
    const tab = await acquireOwnedTab({
      findReusable: async () => {
        reusableCalls++
        return reusableCalls === 1 ? 'contested-blank' : null
      },
      create: async () => `created-${++created}`,
      claim: async (candidate) => candidate === 'created-2',
    })

    expect(tab).toEqual({ tab: 'created-2', source: 'created' })
    expect(created).toBe(2)
  })

  it('fails after bounded repeated claim losses', async () => {
    await expect(
      acquireOwnedTab({
        findReusable: async () => null,
        create: async () => 'created',
        claim: async () => false,
        attempts: 2,
      }),
    ).rejects.toThrow('another session won each tab claim')
  })
})

describe('acquireAndNavigateOwnedTab', () => {
  it('releases a reused tab when navigation fails without closing it', async () => {
    const released: string[] = []
    const discarded: string[] = []
    const sources: string[] = []

    await expect(
      acquireAndNavigateOwnedTab({
        findReusable: async () => 'blank',
        create: async () => 'created',
        claim: async () => true,
        release: async (tab) => released.push(tab),
        navigate: async (_tab, source) => {
          sources.push(source)
          throw new Error('navigation failed')
        },
        discardCreated: async (tab) => {
          discarded.push(tab)
        },
      }),
    ).rejects.toThrow('navigation failed')

    expect(released).toEqual(['blank'])
    expect(discarded).toEqual([])
    expect(sources).toEqual(['reused'])
  })

  it('releases and closes a newly created tab when navigation fails', async () => {
    const released: string[] = []
    const discarded: string[] = []
    const sources: string[] = []

    await expect(
      acquireAndNavigateOwnedTab({
        findReusable: async () => null,
        create: async () => 'created',
        claim: async () => true,
        release: async (tab) => released.push(tab),
        navigate: async (_tab, source) => {
          sources.push(source)
          throw new Error('navigation failed')
        },
        discardCreated: async (tab) => {
          discarded.push(tab)
        },
      }),
    ).rejects.toThrow('navigation failed')

    expect(released).toEqual(['created'])
    expect(discarded).toEqual(['created'])
    expect(sources).toEqual(['created'])
  })
})

describe('SerializedOwnedTabOpener', () => {
  it('returns different tabs for concurrent opens in one session', async () => {
    const opener = new SerializedOwnedTabOpener<string>()
    const owners = new Set<string>()
    const tabs = ['blank']
    let created = 0
    let firstClaimed!: () => void
    const firstClaim = new Promise<void>((resolve) => {
      firstClaimed = resolve
    })
    let releaseFirstNavigation!: () => void
    const firstNavigation = new Promise<void>((resolve) => {
      releaseFirstNavigation = resolve
    })
    const options = (navigationGate?: Promise<void>) => ({
      findReusable: async () => tabs.find((tab) => !owners.has(tab)) ?? null,
      create: async () => {
        const tab = `created-${++created}`
        tabs.push(tab)
        return tab
      },
      claim: async (tab: string) => {
        if (owners.has(tab)) return false
        owners.add(tab)
        if (tab === 'blank') firstClaimed()
        return true
      },
      release: async (tab: string) => owners.delete(tab),
      navigate: async () => navigationGate,
    })

    const first = opener.open(options(firstNavigation))
    const second = opener.open(options())
    await firstClaim
    expect(owners).toEqual(new Set(['blank']))
    releaseFirstNavigation()

    await expect(Promise.all([first, second])).resolves.toEqual(['blank', 'created-1'])
    expect(owners).toEqual(new Set(['blank', 'created-1']))
  })

  it('consumes the exact IAB bootstrap once, then creates real tabs', async () => {
    const opener = new SerializedOwnedTabOpener<string>('bootstrap')
    const found: string[] = []
    let created = 0
    const options = {
      findBootstrap: async (targetId: string) => {
        found.push(targetId)
        return 'bootstrap'
      },
      useBootstrap: async (tab: string) => tab,
      create: async () => `created-${++created}`,
    }

    await expect(opener.openBootstrapFirst(options)).resolves.toBe('bootstrap')
    await expect(opener.openBootstrapFirst(options)).resolves.toBe('created-1')
    expect(found).toEqual(['bootstrap'])
  })

  it('falls back to creation when the exact IAB bootstrap is stale', async () => {
    const opener = new SerializedOwnedTabOpener<string>('closed-bootstrap')
    let created = 0

    await expect(
      opener.openBootstrapFirst({
        findBootstrap: async () => null,
        useBootstrap: async (tab) => tab,
        create: async () => `created-${++created}`,
      }),
    ).resolves.toBe('created-1')
  })

  it('serializes concurrent IAB opens so only the first consumes bootstrap', async () => {
    const opener = new SerializedOwnedTabOpener<string>('bootstrap')
    let created = 0
    let releaseNavigation!: () => void
    const navigation = new Promise<void>((resolve) => {
      releaseNavigation = resolve
    })
    let bootstrapStarted!: () => void
    const started = new Promise<void>((resolve) => {
      bootstrapStarted = resolve
    })
    const options = {
      findBootstrap: async () => 'bootstrap',
      useBootstrap: async (tab: string) => {
        bootstrapStarted()
        await navigation
        return tab
      },
      create: async () => `created-${++created}`,
    }

    const first = opener.openBootstrapFirst(options)
    const second = opener.openBootstrapFirst(options)
    await started
    expect(created).toBe(0)
    releaseNavigation()

    await expect(Promise.all([first, second])).resolves.toEqual(['bootstrap', 'created-1'])
  })

  it('revalidates bootstrap after a failed first navigation', async () => {
    const opener = new SerializedOwnedTabOpener<string>('bootstrap')
    let attempts = 0
    const options = {
      findBootstrap: async () => 'bootstrap',
      useBootstrap: async (tab: string) => {
        attempts++
        if (attempts === 1) throw new Error('navigation failed')
        return tab
      },
      create: async () => 'created',
    }

    await expect(opener.openBootstrapFirst(options)).rejects.toThrow('navigation failed')
    await expect(opener.openBootstrapFirst(options)).resolves.toBe('bootstrap')
  })
})

describe('isReusableIabBootstrapTarget', () => {
  it('accepts only the exact blank target owned by this relay session', () => {
    expect(
      isReusableIabBootstrapTarget(
        { targetId: 'bootstrap', isBlank: true, owner: 'relay-1' },
        'bootstrap',
        'relay-1',
      ),
    ).toBe(true)
  })

  it.each([
    ['another same-owner blank', { targetId: 'other', isBlank: true, owner: 'relay-1' }],
    ['a navigated exact target', { targetId: 'bootstrap', isBlank: false, owner: 'relay-1' }],
    ['a foreign exact target', { targetId: 'bootstrap', isBlank: true, owner: 'relay-2' }],
    ['an unclaimed exact target', { targetId: 'bootstrap', isBlank: true }],
  ])('rejects %s', (_label, candidate) => {
    expect(isReusableIabBootstrapTarget(candidate, 'bootstrap', 'relay-1')).toBe(false)
  })
})

describe('selectReusableBlankTargetId', () => {
  it('reuses an unclaimed about:blank — the leftover AUTO_ENABLE tab', () => {
    expect(
      selectReusableBlankTargetId([
        { targetId: 'xhs', isBlank: false },
        { targetId: 'blank', isBlank: true },
      ]),
    ).toBe('blank')
  })

  it('does not take a blank another session already claimed', () => {
    expect(
      selectReusableBlankTargetId([{ targetId: 'blank', isBlank: true, owner: 's1' }]),
    ).toBeUndefined()
  })

  it('does not adopt a tab that already has a URL', () => {
    expect(
      selectReusableBlankTargetId([{ targetId: 'ctrip', isBlank: false }]),
    ).toBeUndefined()
  })

  it('picks the first unclaimed blank when several exist', () => {
    expect(
      selectReusableBlankTargetId([
        { targetId: 'owned-blank', isBlank: true, owner: 's1' },
        { targetId: 'first-free', isBlank: true },
        { targetId: 'second-free', isBlank: true },
      ]),
    ).toBe('first-free')
  })
})
