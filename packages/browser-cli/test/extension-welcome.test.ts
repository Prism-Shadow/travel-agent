import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestContext, getExtensionServiceWorker, setupTestContext, type TestContext } from './test-utils.js'

// Load the built page under its actual extension origin, so CSP and packaged asset
// paths are exercised rather than accepting a localhost-only preview.
describe('Travel Browser welcome page', () => {
  let ctx: TestContext | null = null

  beforeAll(async () => {
    ctx = await setupTestContext({ port: 20043, tempDirPrefix: 'travel-welcome-', toggleExtension: false })
  }, 600000)
  afterAll(async () => {
    await cleanupTestContext(ctx)
  })

  it('loads offline assets, persists language and keeps the onboarding usable on a narrow screen', async () => {
    if (!ctx) throw new Error('Browser not initialized')
    const worker = await getExtensionServiceWorker(ctx.browserContext)
    const page = ctx.browserContext.pages()[0]
    const errors: string[] = []
    const remoteRequests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url())
    })
    const extensionId = new URL(worker.url()).host
    const welcomeUrl = `chrome-extension://${extensionId}/src/welcome.html`
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto(welcomeUrl)
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await expect.poll(() => page.locator('h1').innerText()).toContain('Connect Chrome.')
    expect(await page.locator('.steps > li').count()).toBe(3)
    expect(await page.locator('.developer-details').getAttribute('open')).toBeNull()
    await expect
      .poll(() =>
        page.locator('img').evaluateAll((images) =>
          images.every((image) => {
            const img = image as { complete: boolean; naturalWidth: number }
            return img.complete && img.naturalWidth > 0
          }),
        ),
      )
      .toBe(true)

    await page.getByRole('button', { name: '中文', exact: true }).click()
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('zh-CN')
    await page.reload()
    await expect.poll(() => page.locator('h1').innerText()).toContain('连接 Chrome')
    expect(await page.getByRole('button', { name: '中文', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('link', { name: '三步开始使用', exact: true }).click()
    expect(new URL(page.url()).hash).toBe('#setup')

    await page.setViewportSize({ width: 320, height: 740 })
    await page.emulateMedia({ colorScheme: 'dark' })
    const summary = page.locator('summary').first()
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('details').first().getAttribute('open')).toBe('')
    expect(await page.locator('.status-list').isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const ink = await page.evaluate(() =>
      window.getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    )
    expect(ink).toBe('#eef2fc')
    expect(remoteRequests).toEqual([])
    expect(errors).toEqual([])
  })
})
