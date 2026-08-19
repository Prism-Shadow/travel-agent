/**
 * Conditional playwright-core import. When patchright mode is enabled via
 * PENGUIN_BROWSER_PATCHRIGHT=1 env var, imports from @playwriter/patchright-core
 * instead of @xmorse/playwright-core. Both packages expose identical APIs.
 *
 * Type imports continue to use @xmorse/playwright-core directly (types are
 * the same in both packages) so TypeScript resolution works without the
 * optional patchright dep being installed.
 */

export type {
  Page,
  Frame,
  Browser,
  BrowserContext,
  Locator,
  FrameLocator,
  ElementHandle,
  CDPSession,
  MouseActionEvent,
} from '@xmorse/playwright-core'

export type { BrowserType } from '@xmorse/playwright-core'

type Chromium = typeof import('@xmorse/playwright-core').chromium

let _chromium: Chromium | undefined

/**
 * Returns the chromium BrowserType, loading from patchright-core if enabled.
 * Caches after first call.
 */
export async function getChromium(): Promise<Chromium> {
  if (_chromium) {
    return _chromium
  }
  if (isPatchrightEnabled()) {
    try {
      // Dynamic import — @playwriter/patchright-core is an optional dependency.
      // Types come from @xmorse/playwright-core (identical API surface).
      const mod: { chromium: Chromium } = await import('@playwriter/patchright-core' as string)
      _chromium = mod.chromium
    } catch (e: unknown) {
      throw new Error(
        '@playwriter/patchright-core is not installed. Install it with: pnpm add @playwriter/patchright-core',
        { cause: e },
      )
    }
  } else {
    const mod = await import('@xmorse/playwright-core')
    _chromium = mod.chromium
  }
  return _chromium!
}

export function isPatchrightEnabled(): boolean {
  return process.env.PENGUIN_BROWSER_PATCHRIGHT === '1' || process.env.PENGUIN_BROWSER_PATCHRIGHT === 'true'
}
