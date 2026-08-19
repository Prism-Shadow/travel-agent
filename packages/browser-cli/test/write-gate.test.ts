/**
 * The write gate (write-gate.ts, payment-gate.ts, handover-state.ts).
 *
 * Design/002 §6.5 asks for an enumeration rather than a sample, so the first test here walks the
 * whole enumerated surface — every method on the list, on a page double — and checks each one is
 * refused while somebody else holds the page. A gate that covered eight of nine would be a gate
 * with one way around it, and the one that was missed is the one that gets used.
 *
 * The payment half is the same idea with a different question: not "who has the page" but "is this
 * the control that takes the money". It leans towards refusing, because a refused click costs one
 * card and a missed one costs somebody's money.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  applyControlEvent,
  controlSnapshot,
  drainWrites,
  inFlightWrites,
  resetControlForTests,
  trackWrite,
} from '../src/executor/handover-state.js'
import { agentMayClickPay, assertClickAllowed, looksLikePayment } from '../src/executor/payment-gate.js'
import { guardHelper, guardPage, guardPlaywrightObject, unguard } from '../src/executor/write-gate.js'

const SESSION = 'session-under-test'

afterEach(() => {
  resetControlForTests()
})

/** A Playwright-shaped double: enough surface for the gate, none of the browser. */
function fakePage() {
  const calls: string[] = []
  const locator = (description: string): Record<string, unknown> => ({
    click: async () => {
      calls.push(`${description}.click`)
    },
    fill: async () => {
      calls.push(`${description}.fill`)
    },
    innerText: async () => description,
    getAttribute: async () => null,
    first: () => locator(`${description}.first`),
    nth: () => locator(`${description}.nth`),
  })
  const page = {
    calls,
    url: () => 'https://example.com/',
    isClosed: () => false,
    click: async (selector: string) => {
      calls.push(`page.click:${selector}`)
    },
    dblclick: async () => {
      calls.push('page.dblclick')
    },
    fill: async () => {
      calls.push('page.fill')
    },
    type: async () => {
      calls.push('page.type')
    },
    press: async () => {
      calls.push('page.press')
    },
    goto: async () => {
      calls.push('page.goto')
    },
    selectOption: async () => {
      calls.push('page.selectOption')
    },
    check: async () => {
      calls.push('page.check')
    },
    uncheck: async () => {
      calls.push('page.uncheck')
    },
    setInputFiles: async () => {
      calls.push('page.setInputFiles')
    },
    tap: async () => {
      calls.push('page.tap')
    },
    content: async () => '<html></html>',
    innerText: async () => 'page text',
    getAttribute: async () => null,
    evaluate: async () => 42,
    locator: (selector: string) => locator(`locator(${selector})`),
    getByRole: (role: string, options?: { name?: string }) =>
      locator(`getByRole(${role} ${options?.name ?? ''})`),
  }
  return page
}

describe("the enumerated surface, while the person holds the page", () => {
  const WRITES = [
    'click',
    'dblclick',
    'fill',
    'type',
    'press',
    'goto',
    'selectOption',
    'check',
    'uncheck',
    'setInputFiles',
    'tap',
  ] as const

  it.each(WRITES)("refuses page.%s", async (method) => {
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION) as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >
    applyControlEvent(SESSION, { type: 'request_handover', kind: 'human_challenge' })
    applyControlEvent(SESSION, { type: 'drained' })

    await expect(guarded[method]!('#x')).rejects.toThrow(/IAB_USER_CONTROL/)
    expect(page.calls).toEqual([]);
  })

  it("refuses a write through a locator, not just through the page", async () => {
    // The locator is where most real code writes. A gate on `page.click` alone would be a gate on
    // the method nobody calls.
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION) as {
      getByRole: (role: string, options?: { name?: string }) => { click: () => Promise<void> }
    }
    const button = guarded.getByRole('button', { name: '下一步' })
    applyControlEvent(SESSION, { type: 'request_handover', kind: 'human_challenge' })
    applyControlEvent(SESSION, { type: 'drained' })

    await expect(button.click()).rejects.toThrow(/IAB_USER_CONTROL/)
  })

  it("keeps reads open, because watching the page is how the agent knows they finished", async () => {
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION) as {
      content: () => Promise<string>
      url: () => string
    }
    applyControlEvent(SESSION, { type: 'request_handover', kind: 'human_challenge' })
    applyControlEvent(SESSION, { type: 'drained' })

    await expect(guarded.content()).resolves.toContain('<html>')
    expect(guarded.url()).toBe('https://example.com/')
  })

  it("refuses reads too during a secret phase", async () => {
    // The difference between user_control and secret_phase: here the value is in the page, and
    // reading it is the thing being prevented (003 §1.3).
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION) as {
      content: () => Promise<string>
      evaluate: () => Promise<number>
    }
    applyControlEvent(SESSION, { type: 'enter_secret_phase', field: 'cvv' })

    // Thrown as the call is made, not as a rejected promise: a read may be synchronous
    // (`viewportSize()`), and wrapping every one in a promise would change what the agent's code
    // gets back. Inside the async code that actually calls these, a synchronous throw is a
    // rejection anyway.
    expect(() => guarded.content()).toThrow(/IAB_SECRET_PHASE/)
    expect(() => guarded.evaluate()).toThrow(/IAB_SECRET_PHASE/)
    await expect((async () => guarded.content())()).rejects.toThrow(/IAB_SECRET_PHASE/)
  })

  it("lets everything through under agent control", async () => {
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION) as {
      click: (selector: string) => Promise<void>
      fill: () => Promise<void>
    }
    await guarded.click('#next')
    await guarded.fill()
    expect(page.calls).toEqual(['page.click:#next', 'page.fill'])
  })
})

describe("draining before the person gets the page", () => {
  it("waits for a write that is already in flight", async () => {
    // The whole reason `handing_over` exists: at the moment the button is pressed the executor may
    // have an `await page.click()` travelling.
    let release!: () => void
    const inFlight = trackWrite(SESSION, () => new Promise<void>((resolve) => {
      release = resolve
    }))
    expect(inFlightWrites(SESSION)).toBe(1)

    const drained = drainWrites(SESSION, 1_000)
    release()
    await inFlight
    await expect(drained).resolves.toBe(true)
  })

  it("gives up after the budget rather than blocking the person", async () => {
    let release!: () => void
    const inFlight = trackWrite(SESSION, () => new Promise<void>((resolve) => {
      release = resolve
    }))
    await expect(drainWrites(SESSION, 60)).resolves.toBe(false)
    release()
    await inFlight
  })
})

describe("the payment gate", () => {
  it.each([
    '立即支付',
    '去支付',
    '确认支付',
    '提交订单',
    '立即预订',
    '去结算',
    'Pay now',
    'Confirm and pay',
    'Place order',
    'Checkout',
    'Buy now',
  ])('reads %s as the control that takes the money', (label) => {
    expect(looksLikePayment(label)).toBe(true)
  })

  it.each(['下一步', '搜索', '选择', 'Continue', 'Search', 'Select seat', '返回'])(
    'leaves %s alone',
    (label) => {
      expect(looksLikePayment(label)).toBe(false)
    },
  )

  it('refuses the click, with a message that says what to do instead', () => {
    expect(() => assertClickAllowed('立即支付', {})).toThrow(/IAB_PAYMENT_CLICK_BLOCKED/)
    try {
      assertClickAllowed('立即支付', {})
    } catch (error) {
      expect((error as Error).message).toMatch(/commitment_confirmation/)
      expect((error as Error).message).toMatch(/let them complete the payment/i)
    }
  })

  it('is closed unless the flag says otherwise, in every spelling that is not clearly yes', () => {
    expect(agentMayClickPay({})).toBe(false)
    expect(agentMayClickPay({ PENGUIN_FLAGS: 'iab.enabled' })).toBe(false)
    expect(agentMayClickPay({ PENGUIN_FLAGS: 'payments.agent_click_pay=false' })).toBe(false)
    // A typo must never be the reason a payment goes through.
    expect(agentMayClickPay({ PENGUIN_FLAGS: 'payments.agent_click_pay=ture' })).toBe(false)
    expect(agentMayClickPay({ PENGUIN_FLAGS: 'payments.agent_click_pay' })).toBe(true)
    expect(agentMayClickPay({ PENGUIN_FLAGS: 'payments.agent_click_pay=on' })).toBe(true)
  })

  it('blocks a pay button reached through a locator', async () => {
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION, {}) as {
      getByRole: (role: string, options?: { name?: string }) => { click: () => Promise<void> }
    }
    await expect(guarded.getByRole('button', { name: '立即支付' }).click()).rejects.toThrow(
      /IAB_PAYMENT_CLICK_BLOCKED/,
    )
    expect(page.calls).toEqual([])
  })

  it('blocks a pay button named only in the selector', async () => {
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION, {}) as {
      click: (selector: string) => Promise<void>
    }
    await expect(guarded.click('text=确认支付')).rejects.toThrow(/IAB_PAYMENT_CLICK_BLOCKED/)
  })

  it('blocks a submit helper that would commit the order', async () => {
    // `submitAndClassify` reaches the page by its own route, so gating the page object would have
    // missed it — the sampling failure 002 §6.5 warns about.
    const submit = guardHelper(async (_opts: { submit: string }) => 'submitted', {
      sessionId: SESSION,
      name: 'submitAndClassify',
      clicks: true,
      describe: (opts) => opts.submit,
      env: {},
    })
    await expect(submit({ submit: '提交订单' })).rejects.toThrow(/IAB_PAYMENT_CLICK_BLOCKED/)
    await expect(submit({ submit: '搜索' })).resolves.toBe('submitted')
  })

  it('lets the click through when the build allows it', async () => {
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION, {
      PENGUIN_FLAGS: 'payments.agent_click_pay',
    }) as { click: (selector: string) => Promise<void> }
    await guarded.click('text=立即支付')
    expect(page.calls).toEqual(['page.click:text=立即支付'])
  })
})

describe("control state is per session", () => {
  it("does not freeze another conversation's agent", async () => {
    const other = 'another-session'
    applyControlEvent(SESSION, { type: 'request_handover', kind: 'human_challenge' })
    applyControlEvent(SESSION, { type: 'drained' })

    expect(controlSnapshot(SESSION).state).toBe('user_control')
    expect(controlSnapshot(other).state).toBe('agent_control')

    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, other) as {
      click: (selector: string) => Promise<void>
    }
    await expect(guarded.click('#next')).resolves.toBeUndefined()
  })
})

describe("identity, which the executor and Playwright both rely on", () => {
  it("hands back the real object when asked", () => {
    // The gate is a Proxy, so it is *not* the object it wraps. The executor compares
    // `state.page === page` to notice a closed tab, and Playwright takes a `Page` as an argument in
    // a few places; both need the real one.
    const page = fakePage()
    const guarded = guardPage(page as unknown as Record<string, unknown>, SESSION)
    expect(unguard(guarded)).toBe(page)
    expect(unguard(page)).toBe(page)
    expect(unguard(undefined)).toBeUndefined()
  })

  it("never passes a wrapped object on as an argument", async () => {
    // A gated locator handed to a gated method must arrive unwrapped: Playwright would not
    // recognise a Proxy of an object it created.
    const seen: unknown[] = []
    const target = {
      dragTo: async (other: unknown) => {
        seen.push(other)
      },
      innerText: async () => 'row',
      getAttribute: async () => null,
    }
    const source = guardPlaywrightObject(target, { sessionId: SESSION, description: 'a' })
    const other = guardPlaywrightObject({ id: 'b' }, { sessionId: SESSION, description: 'b' })
    await (source as unknown as { dragTo: (o: unknown) => Promise<void> }).dragTo(other)
    expect(seen[0]).toBe(unguard(other))
  })
})
