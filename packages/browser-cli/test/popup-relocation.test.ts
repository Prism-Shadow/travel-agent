/**
 * Tests for auto-relocation of popup windows to tabs.
 * - Connected source tab → popup gets relocated + auto-attached.
 * - No source tab connected → popup is left alone.
 */

import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSimpleServer,
  type TestContext,
  type SimpleServer,
  js,
} from './test-utils.js'
import '../src/shared/test-declarations.js'

const TEST_PORT = 19995

/**
 * Executor-side snippets: they run inside the `execute` tool's sandbox as plain JS, and stay
 * under the executor's 10 s code limit.
 *
 * WAIT_FOR_NEW_TARGET_PAGE resolves to the first page at /target that is not in `before`.
 * WAIT_FOR_NO_TEST_PAGES waits until the fixture pages have actually left context.pages(): a
 * close in extension mode takes effect a moment after the call returns, and a page left over
 * from one case must not be found by the next.
 */
const WAIT_FOR_NEW_TARGET_PAGE = `(async () => {
  const deadline = Date.now() + 8000;
  for (;;) {
    const found = context.pages().find((p) => !before.has(p) && p.url().endsWith('/target'));
    if (found) return found;
    if (Date.now() > deadline) throw new Error('no new /target page: ' + JSON.stringify(context.pages().map((p) => p.url())));
    await new Promise((r) => setTimeout(r, 100));
  }
})()`

const WAIT_FOR_NO_TEST_PAGES = `(async () => {
  const deadline = Date.now() + 8000;
  while (context.pages().some((p) => p.url().endsWith('/opener') || p.url().endsWith('/target'))) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 100));
  }
})()`

describe('Popup window relocation', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null
  let htmlServer: SimpleServer | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-popup-test-',
      toggleExtension: true,
    })

    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup

    htmlServer = await createSimpleServer({
      routes: {
        '/opener': `<!doctype html>
<html>
  <body>
    <button id="open-popup" onclick="window.open('/target', '', 'width=400,height=300,popup=1')">Open popup</button>
    <a id="open-tab" href="/target" target="_blank">Open tab</a>
  </body>
</html>`,
        '/target': `<!doctype html>
<html>
  <body>
    <h1 id="target-heading">Popup target page</h1>
  </body>
</html>`,
      },
    })
  }, 600000)

  afterAll(async () => {
    if (htmlServer) {
      await htmlServer.close()
    }
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  it('relocates popup window into main browser context as a tab', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.popupTestPage = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage());
          await state.popupTestPage.goto('${htmlServer.baseUrl}/opener', { waitUntil: 'domcontentloaded' });
          return { url: state.popupTestPage.url(), pagesBefore: context.pages().length };
        `,
      },
    })

    // The state under test is "a page that was not there before the click is now in
    // context.pages() at /target". Which Playwright event announces it depends on the relocation
    // path (the popup window's own target, or the tab it is moved into), so the test polls for the
    // state itself instead of sleeping a fixed interval that a loaded machine outruns (GitHub #8).
    const clickResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const before = new Set(context.pages());
          await state.popupTestPage.click('#open-popup');
          await ${WAIT_FOR_NEW_TARGET_PAGE};
          return { pagesAfter: context.pages().length, allUrls: context.pages().map((p) => p.url()) };
        `,
      },
    })

    const clickOutput = (clickResult as any).content[0].text as string

    expect(clickOutput).toContain('/target')
    expect((clickResult as any).isError).not.toBe(true)
    expect(clickOutput).toContain('[WARNING] New page opened from current page')
    expect(clickOutput).not.toContain('Popup window detected')
    expect(clickOutput).not.toContain('cannot be controlled by penguin-browser')

    const windowTypes = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.map((w) => w.type)
    })
    expect(windowTypes).not.toContain('popup')
    expect(windowTypes).toContain('normal')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const targetPage = context.pages().find((p) => p.url().endsWith('/target'));
          if (targetPage) { await targetPage.close(); }
          await state.popupTestPage.close();
          delete state.popupTestPage;
          await ${WAIT_FOR_NO_TEST_PAGES};
        `,
      },
    })
  }, 60000)

  it('auto-connects a regular target=_blank tab from a connected page', async () => {
    if (!htmlServer) throw new Error('html server not initialized')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.targetBlankPage = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage());
          await state.targetBlankPage.goto('${htmlServer.baseUrl}/opener', { waitUntil: 'domcontentloaded' });
        `,
      },
    })

    const clickResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const before = new Set(context.pages());
          await state.targetBlankPage.click('#open-tab', { noWaitAfter: true });
          await ${WAIT_FOR_NEW_TARGET_PAGE};
          return { pagesAfter: context.pages().length, allUrls: context.pages().map((p) => p.url()) };
        `,
      },
    })

    const clickOutput = (clickResult as any).content[0].text as string
    expect((clickResult as any).isError).not.toBe(true)
    expect(clickOutput).toContain('/target')
    expect(clickOutput).toContain('[WARNING] New page opened from current page')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const targetPage = context.pages().find((p) => p.url().endsWith('/target'));
          if (targetPage) await targetPage.close();
          await state.targetBlankPage.close();
          delete state.targetBlankPage;
          await ${WAIT_FOR_NO_TEST_PAGES};
        `,
      },
    })
  }, 60000)

  it('pins an element from the toolbar and restores the page cursor', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const page = await browserContext.newPage()

    await page.goto(`${htmlServer.baseUrl}/opener`, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const toolbar = page.locator('[data-penguin-browser-toolbar]')
    expect(await toolbar.count()).toBe(1)
    await page.evaluate(() => {
      document.documentElement.style.cursor = 'wait'
      const target = document.createElement('button')
      target.id = 'toolbar-pin-target'
      target.textContent = 'Pin target'
      target.style.cssText = 'position:fixed;left:100px;top:200px;width:120px;height:40px;z-index:10'
      document.body.appendChild(target)
    })

    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    await page.mouse.click(toolbarBox!.x + 16, toolbarBox!.y + 16)
    await expect.poll(() => page.evaluate(() => document.documentElement.style.cursor)).toBe('crosshair')

    await page.mouse.move(150, 220)
    await page.mouse.click(150, 220)

    await expect
      .poll(() =>
        page.evaluate(() => ({
          cursor: document.documentElement.style.cursor,
          pinnedId: window.penguinBrowserPinnedElem1?.id,
        })),
      )
      .toEqual({ cursor: 'wait', pinnedId: 'toolbar-pin-target' })

    await page.mouse.click(toolbarBox!.x + toolbarBox!.width - 16, toolbarBox!.y + 16)
    await expect.poll(() => toolbar.evaluate((element) => window.getComputedStyle(element).display)).toBe('none')

    await page.close()
  }, 60000)

  it('leaves popup windows alone when no Penguin Browser tab is connected', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => {
      setTimeout(r, 200)
    })

    // Drive the browser directly via browserContext (not MCP/extension) so
    // the opener tab stays unconnected.
    const unconnectedPage = await browserContext.newPage()
    await unconnectedPage.goto(`${htmlServer.baseUrl}/opener`, { waitUntil: 'domcontentloaded' })
    await unconnectedPage.bringToFront()
    await unconnectedPage.click('#open-popup')
    // If relocation DID happen, the popup window would be gone by now.
    await new Promise((r) => {
      setTimeout(r, 1500)
    })

    const windowTypes = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.map((w) => w.type)
    })
    expect(windowTypes).toContain('popup')

    const windowIdsToClose = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.filter((w) => w.type === 'popup').map((w) => w.id)
    })
    for (const windowId of windowIdsToClose) {
      if (windowId !== undefined) {
        await serviceWorker.evaluate(async (id: number) => {
          await chrome.windows.remove(id)
        }, windowId)
      }
    }
    await unconnectedPage.close()
  }, 60000)
})
