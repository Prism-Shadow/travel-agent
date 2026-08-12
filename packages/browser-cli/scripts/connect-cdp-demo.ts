/**
 * Minimal proof: connect a Playwright client straight to the running
 * penguin-browser relay via the CDP URL on localhost:19989.
 *
 * Prereqs:
 *   1. `penguin-browser serve --token secret_token --replace` is running
 *   2. The Penguin Browser Chrome extension is connected (toggled on a tab)
 *
 * Run:
 *   tsx connect-cdp.ts
 */

import { chromium } from '@xmorse/playwright-core'

const TOKEN = process.env.PENGUIN_BROWSER_TOKEN
if (!TOKEN) {
  throw new Error('Set PENGUIN_BROWSER_TOKEN env var to the token you passed to `penguin-browser serve --token …`.')
}
const CLIENT_ID = `cdp-demo-${Date.now()}`
// Set HOST to your tunnel for remote test, e.g. "wss://mcp.ivanleo.com",
// or leave default for local.
const HOST = process.env.PENGUIN_BROWSER_CDP_HOST || 'ws://127.0.0.1:19989'

const cdpUrl = `${HOST}/cdp/${CLIENT_ID}?token=${TOKEN}`

async function main(): Promise<void> {
  console.log('Connecting to:', cdpUrl)

  const browser = await chromium.connectOverCDP(cdpUrl)

  const contexts = browser.contexts()
  console.log(`Got ${contexts.length} browser context(s)`)

  const pages = contexts.flatMap((ctx) => {
    return ctx.pages()
  })
  console.log(`Got ${pages.length} page(s):`)
  pages.forEach((page, i) => {
    console.log(`  [${i}] ${page.url()}`)
  })

  if (pages.length === 0) {
    console.error('No pages — toggle the Penguin Browser extension on a tab first.')
    await browser.close()
    process.exit(1)
  }

  const page = pages[0]
  console.log('\nDriving page[0]...')
  await page.goto('https://example.com')
  console.log('Title:', await page.title())

  await browser.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
