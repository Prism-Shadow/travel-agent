/**
 * The gate every write to a page goes through.
 *
 * Design/002 §6.5 is blunt about the shape this has to take: *enumerate, do not sample*. A gate
 * that covers `clickThrough` but not `page.click` is not a gate — it is a suggestion, and the one
 * call site that skipped it is the one that will be reached while somebody is typing a card number.
 * So the enumerated surface is wrapped at the object the agent actually holds: the `Page`, the
 * `Locator`s it produces, the `ElementHandle`s it resolves, and the frame locators in between.
 *
 * Two questions are asked before a write:
 *
 * 1. **Who has the page?** During a handover the agent is refused with a code it can act on; during
 *    a secret phase even reads are refused, because reading is the risk (003 §1.3).
 * 2. **Is this the button that takes the money?** See `payment-gate.ts`. This build does not press
 *    it, and the refusal says what to do instead.
 *
 * **This is a guardrail, not a boundary.** The executor's vm is explicitly not a security boundary
 * (003 §1.2), and an agent that wants to reach around a wrapper — through `context.pages()`, a raw
 * CDP session, its own `import` — can. What the wrapper buys is that the ordinary path stops, in a
 * way that is visible in the transcript, rather than a payment happening because nobody wired the
 * check into the fifth method that can click something.
 */
import { assertMayOperate, trackWrite } from './handover-state.js'
import { assertClickAllowed } from './payment-gate.js'

/**
 * How a wrapped object hands back the real one.
 *
 * The gate is a Proxy, which means it is *not* the object it wraps, and identity is load-bearing in
 * several places the agent's code touches: the executor compares `state.page === page` to notice a
 * closed tab, and Playwright's own APIs take a `Page` as an argument in a few places. Passing a
 * Proxy into those is how a guardrail turns into a bug, so anything that hands an object back to
 * Playwright — or compares one — unwraps first.
 */
const GUARDED_TARGET = Symbol.for('penguin.guardedTarget')

/** The real object behind a gate, or the value itself when it was never wrapped. */
export function unguard<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const raw = (value as Record<symbol, unknown>)[GUARDED_TARGET]
  return (raw as T) ?? value
}

/**
 * Methods that change the page (002 §6.5's list, plus the aliases Playwright has grown since).
 *
 * `goto` is a write because navigating away from a page somebody is working in is exactly as
 * disruptive as clicking in it.
 */
const WRITE_METHODS: ReadonlySet<string> = new Set([
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'pressSequentially',
  'goto',
  'selectOption',
  'check',
  'uncheck',
  'setChecked',
  'setInputFiles',
  'tap',
  'dragTo',
  'clear',
  'hover',
  'focus',
  'goBack',
  'goForward',
  'reload',
])

/** The subset of writes that can commit a purchase, and therefore face the payment gate. */
const CLICK_METHODS: ReadonlySet<string> = new Set(['click', 'dblclick', 'tap', 'press'])

/** Methods whose result is another addressable thing, and so must come back wrapped. */
const LOCATOR_FACTORIES: ReadonlySet<string> = new Set([
  'all',
  'elementHandles',
  '$$',
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
  'frameLocator',
  'first',
  'last',
  'nth',
  'filter',
  'and',
  'or',
  'contentFrame',
  'elementHandle',
  'waitForSelector',
  '$',
])

/**
 * Calls that are pure bookkeeping and stay available even in a secret phase.
 *
 * Refusing these would break the code that has to *notice* the state — a wait loop asking whether
 * the page is still open, a listener being detached — and none of them reads page content.
 */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  'url',
  'isClosed',
  'context',
  'mainFrame',
  'frames',
  'on',
  'off',
  'once',
  'addListener',
  'removeListener',
  'removeAllListeners',
  'setDefaultTimeout',
  'setDefaultNavigationTimeout',
  'video',
  'workers',
])

/** Where a wrapped object came from, so a refusal can name what it refused. */
interface GateContext {
  sessionId: string
  /** Accumulated description of the locator chain: selectors, role names, text. */
  description: string
  env?: NodeJS.ProcessEnv
}

function describeArgs(method: string, args: unknown[]): string {
  const parts: string[] = []
  for (const arg of args) {
    if (typeof arg === 'string') parts.push(arg)
    else if (arg && typeof arg === 'object') {
      const record = arg as { name?: unknown; hasText?: unknown }
      if (typeof record.name === 'string') parts.push(record.name)
      else if (record.name instanceof RegExp) parts.push(String(record.name))
      if (typeof record.hasText === 'string') parts.push(record.hasText)
      else if (record.hasText instanceof RegExp) parts.push(String(record.hasText))
    }
  }
  return parts.length > 0 ? `${method}(${parts.join(' ')})` : method
}

/**
 * The best label available for a control, without paying for it.
 *
 * The chain's own description first — `getByRole('button', { name: '立即支付' })` already says what
 * the control is called, and it costs nothing. Only then a short look at the live element, which is
 * wrapped in a timeout and a catch: a gate that made every click wait on a DOM read would be a
 * performance bug, and one that threw when the element had gone would turn a lost race into a
 * crash.
 */
async function labelFor(target: unknown, context: GateContext, args: unknown[]): Promise<string> {
  const fromArgs = args.filter((arg): arg is string => typeof arg === 'string').join(' ')
  const described = `${context.description} ${fromArgs}`.trim()
  const readable = target as {
    getAttribute?: (name: string, options?: unknown) => Promise<string | null>
    innerText?: (options?: unknown) => Promise<string>
  }
  let live = ''
  try {
    if (typeof readable.innerText === 'function') {
      live = await readable.innerText({ timeout: 250 })
    }
    if (!live && typeof readable.getAttribute === 'function') {
      live = (await readable.getAttribute('aria-label', { timeout: 250 })) ?? ''
    }
  } catch {
    // The element may be gone, detached, or simply slow. The description still stands.
  }
  return `${described} ${live}`.trim()
}

/**
 * Wraps a Playwright object so its writes go through the gate.
 *
 * Returns a Proxy rather than a copy: Playwright's objects carry state and identity that the rest
 * of the executor (and Playwright itself) relies on, and a shallow clone would break both.
 */
export function guardPlaywrightObject<T extends object>(target: T, context: GateContext): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      if (property === GUARDED_TARGET) return object
      const value = Reflect.get(object, property, receiver)
      if (typeof value !== 'function' || typeof property !== 'string') return value
      if (ALWAYS_ALLOWED.has(property)) return value.bind(object)

      if (WRITE_METHODS.has(property)) {
        return async (...args: unknown[]) => {
          assertMayOperate(context.sessionId, 'write')
          if (CLICK_METHODS.has(property)) {
            assertClickAllowed(await labelFor(object, context, args), context.env)
          }
          return await trackWrite(context.sessionId, async () =>
            (value as (...rest: unknown[]) => Promise<unknown>).apply(object, args.map(unguard)),
          )
        }
      }

      if (LOCATOR_FACTORIES.has(property)) {
        return (...args: unknown[]) => {
          assertMayOperate(context.sessionId, 'read')
          const produced = (value as (...rest: unknown[]) => unknown).apply(object, args.map(unguard))
          const nested: GateContext = {
            ...context,
            description: `${context.description} ${describeArgs(property, args)}`.trim(),
          }
          // Arrays come back from `all()` and `$$`, and every element of one is something the
          // agent can write through. Wrapping only the array would have left the enumerated
          // surface reachable one `[0]` away.
          const wrap = (value: unknown): unknown => {
            if (Array.isArray(value)) return value.map(wrap)
            return value && typeof value === 'object'
              ? guardPlaywrightObject(value as object, nested)
              : value
          }
          if (produced && typeof (produced as Promise<unknown>).then === 'function') {
            return (produced as Promise<unknown>).then(wrap)
          }
          return wrap(produced)
        }
      }

      // Everything else is a read. It is refused only in a secret phase, where reading the page is
      // the thing being prevented.
      return (...args: unknown[]) => {
        assertMayOperate(context.sessionId, 'read')
        return (value as (...rest: unknown[]) => unknown).apply(object, args.map(unguard))
      }
    },
  })
}

/** Wraps the session's page. The entry point the executor uses. */
export function guardPage<T extends object>(
  page: T,
  sessionId: string,
  env?: NodeJS.ProcessEnv,
): T {
  return guardPlaywrightObject(page, { sessionId, description: 'page', ...(env ? { env } : {}) })
}

/**
 * Wraps one of the executor's own interaction helpers.
 *
 * `clickThrough`, `fillWithSuggestion`, `pickDate` and `submitAndClassify` reach the page through
 * their own code rather than through the wrapped `page`, so gating the object would have missed
 * them — which is exactly the "enumerate, do not sample" failure 002 §6.5 warns about. The target
 * description they carry is whatever the caller named.
 */
export function guardHelper<TArgs extends unknown[], TResult>(
  helper: (...args: TArgs) => Promise<TResult>,
  options: {
    sessionId: string
    name: string
    /** Pulls a human-readable target out of the helper's own arguments. */
    describe?: (...args: TArgs) => string | null | undefined
    /** Whether this helper can commit a purchase (a click or a submit). */
    clicks: boolean
    env?: NodeJS.ProcessEnv
  },
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    assertMayOperate(options.sessionId, 'write')
    if (options.clicks) {
      const described = options.describe?.(...args) ?? null
      assertClickAllowed(described ? `${options.name} ${described}` : null, options.env)
    }
    return await trackWrite(options.sessionId, async () => helper(...args))
  }
}
