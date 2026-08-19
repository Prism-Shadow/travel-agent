import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestContext, getExtensionServiceWorker, setupTestContext, type TestContext } from './test-utils.js'

const TEST_PORT = 20011
const OWNED_TAB_GROUPS_STORAGE_KEY = 'penguinBrowserOwnedTabGroupsByWindow'
const TAB_GROUP_ID_NONE = -1

describe('MV3 extension lifecycle', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-mv3-lifecycle-',
      toggleExtension: false,
    })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  it('keeps an attached worker alive beyond the idle budget and cleans all state on disconnect', async () => {
    if (!testCtx) throw new Error('Browser not initialized')
    const { browserContext } = testCtx
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const page = await browserContext.newPage()
    await page.goto('https://example.com/mv3-lifecycle')
    await page.bringToFront()

    const connected = await serviceWorker.evaluate(async () => {
      const result = await globalThis.toggleExtensionForActiveTab()
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (activeTab?.id === undefined) throw new Error('No active tab')
      ;(globalThis as any).__mv3LifecycleBootToken = crypto.randomUUID()
      return {
        isConnected: result.isConnected,
        tabId: activeTab.id,
        bootToken: (globalThis as any).__mv3LifecycleBootToken as string,
      }
    })
    expect(connected.isConnected).toBe(true)

    await expect
      .poll(
        async () => {
          return await serviceWorker.evaluate(async (tabId) => {
            return (await chrome.tabs.get(tabId)).groupId
          }, connected.tabId)
        },
        { timeout: 5000 },
      )
      .not.toBe(TAB_GROUP_ID_NONE)
    const groupId = await serviceWorker.evaluate(async (tabId) => {
      return (await chrome.tabs.get(tabId)).groupId
    }, connected.tabId)

    // The relay sends a ping every five seconds and active chrome.debugger
    // sessions are also MV3 keepalives. Do not touch the worker for longer than
    // Chrome's normal 30-second idle budget, then prove its JS realm survived.
    await new Promise((resolve) => setTimeout(resolve, 35000))
    const afterIdle = await serviceWorker.evaluate(async (tabId) => {
      let debuggerAttached = true
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' })
      } catch {
        debuggerAttached = false
      }
      return {
        bootToken: (globalThis as any).__mv3LifecycleBootToken as string | undefined,
        tabState: globalThis.getExtensionState().tabs.get(tabId)?.state,
        debuggerAttached,
      }
    }, connected.tabId)
    expect(afterIdle).toEqual({
      bootToken: connected.bootToken,
      tabState: 'connected',
      debuggerAttached: true,
    })

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })

    await expect
      .poll(
        async () => {
          return await serviceWorker.evaluate(
            async ({ tabId, storageKey }) => {
              const tab = await chrome.tabs.get(tabId)
              let debuggerAttached = true
              try {
                await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' })
              } catch {
                debuggerAttached = false
              }
              const storedGroups = await chrome.storage.session.get(storageKey)
              return {
                trackedTabs: globalThis.getExtensionState().tabs.size,
                debuggerAttached,
                groupId: tab.groupId,
                ownedGroupCount: Object.keys((storedGroups[storageKey] as Record<string, number> | undefined) ?? {})
                  .length,
              }
            },
            { tabId: connected.tabId, storageKey: OWNED_TAB_GROUPS_STORAGE_KEY },
          )
        },
        { timeout: 5000 },
      )
      .toEqual({
        trackedTabs: 0,
        debuggerAttached: false,
        groupId: TAB_GROUP_ID_NONE,
        ownedGroupCount: 0,
      })

    await expect
      .poll(
        async () => {
          const response = await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)
          const status = (await response.json()) as { connected: boolean; activeTargets: number }
          return status
        },
        { timeout: 5000 },
      )
      .toMatchObject({ connected: true, activeTargets: 0 })

    expect(groupId).not.toBe(TAB_GROUP_ID_NONE)
  }, 60000)
})
