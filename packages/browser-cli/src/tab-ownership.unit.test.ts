import { beforeEach, describe, expect, it } from 'vitest'
import { TabRegistry } from './tab-ownership.js'

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
