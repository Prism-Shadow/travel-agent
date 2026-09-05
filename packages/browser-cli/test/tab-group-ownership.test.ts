import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestContext, getExtensionServiceWorker, setupTestContext, type TestContext } from './test-utils.js'

const TEST_PORT = 19997

describe('extension tab group ownership', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-tab-group-ownership-',
      toggleExtension: false,
    })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  it('preserves a same-title user group and owns one group per connected window', async () => {
    if (!testCtx) throw new Error('Browser not initialized')
    const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)

    expect(await serviceWorker.evaluate(() => chrome.runtime.getManifest().name)).toBe('Travel Browser')

    // Reproduce the collision before Travel Browser has attached any tab.
    const userGroup = await serviceWorker.evaluate(async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (activeTab?.id === undefined) throw new Error('No active tab')

      const userTab = await chrome.tabs.create({
        windowId: activeTab.windowId,
        url: 'about:blank',
        active: false,
      })
      if (userTab.id === undefined) throw new Error('No user tab id')

      const groupId = await chrome.tabs.group({ tabIds: [userTab.id] })
      await chrome.tabGroups.update(groupId, {
        title: 'Travel Browser',
        color: 'red',
        collapsed: true,
      })

      return {
        groupId,
        tabId: userTab.id,
        windowId: activeTab.windowId,
      }
    })

    // Hold the first extension-owned group creation until a second window has
    // focus. This deterministically reproduces the production race where a
    // queued sync runs after the user changes windows.
    await serviceWorker.evaluate(() => {
      const tabsApi = chrome.tabs as any
      const originalGroup = tabsApi.group
      let releaseGroup!: () => void
      let signalGroupStarted!: () => void
      const groupGate = new Promise<void>((resolve) => {
        releaseGroup = resolve
      })
      const groupStarted = new Promise<void>((resolve) => {
        signalGroupStarted = resolve
      })
      let blocked = false

      tabsApi.group = async (options: chrome.tabs.GroupOptions) => {
        if (!blocked && options.groupId === undefined) {
          blocked = true
          signalGroupStarted()
          await groupGate
        }
        return await originalGroup.call(tabsApi, options)
      }
      ;(globalThis as any).__tabGroupCreationGate = {
        groupStarted,
        releaseGroup,
        originalGroup,
      }
    })

    const firstConnection = await serviceWorker.evaluate(async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (activeTab?.id === undefined) throw new Error('No active tab')
      const result = await globalThis.toggleExtensionForActiveTab()
      return {
        isConnected: result.isConnected,
        tabId: activeTab.id,
        windowId: activeTab.windowId,
      }
    })
    expect(firstConnection.isConnected).toBe(true)

    await serviceWorker.evaluate(async () => {
      const gate = (globalThis as any).__tabGroupCreationGate
      await Promise.race([
        gate.groupStarted,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Owned tab group creation did not start')), 5000)
        }),
      ])
    })

    const secondConnection = await serviceWorker.evaluate(async () => {
      const secondWindow = await chrome.windows.create({
        url: 'about:blank',
        type: 'normal',
        focused: true,
      })
      if (secondWindow.id === undefined) throw new Error('No second window id')

      const [activeTab] = await chrome.tabs.query({
        active: true,
        windowId: secondWindow.id,
      })
      if (activeTab?.id === undefined) throw new Error('No active tab in second window')

      await chrome.windows.update(secondWindow.id, { focused: true })
      const result = await globalThis.toggleExtensionForActiveTab()
      return {
        isConnected: result.isConnected,
        tabId: activeTab.id,
        windowId: secondWindow.id,
      }
    })
    expect(secondConnection.isConnected).toBe(true)
    expect(secondConnection.windowId).not.toBe(firstConnection.windowId)

    await serviceWorker.evaluate(() => {
      const tabsApi = chrome.tabs as any
      const gate = (globalThis as any).__tabGroupCreationGate
      gate.releaseGroup()
      tabsApi.group = gate.originalGroup
      delete (globalThis as any).__tabGroupCreationGate
    })

    type GroupSnapshot = {
      id: number
      windowId: number
      title?: string
      color: chrome.tabGroups.ColorEnum
      collapsed: boolean
      tabIds: number[]
    }

    const readGroups = async (): Promise<GroupSnapshot[]> => {
      return await serviceWorker.evaluate(async () => {
        const groups = await chrome.tabGroups.query({})
        return await Promise.all(
          groups.map(async (group) => ({
            id: group.id,
            windowId: group.windowId,
            title: group.title,
            color: group.color,
            collapsed: group.collapsed,
            tabIds: (await chrome.tabs.query({ groupId: group.id }))
              .map((tab) => tab.id)
              .filter((id): id is number => id !== undefined)
              .sort((a, b) => a - b),
          })),
        )
      })
    }

    await expect
      .poll(
        async () => {
          const groups = await readGroups()
          return groups.filter(
            (group) => group.id !== userGroup.groupId && group.title === 'Travel Browser' && group.color === 'cyan',
          ).length
        },
        { timeout: 10000 },
      )
      .toBe(2)

    const connectedTabWindows = await serviceWorker.evaluate(
      async ({ firstTabId, secondTabId }) => {
        const [firstTab, secondTab] = await Promise.all([chrome.tabs.get(firstTabId), chrome.tabs.get(secondTabId)])
        return {
          firstWindowId: firstTab.windowId,
          secondWindowId: secondTab.windowId,
        }
      },
      {
        firstTabId: firstConnection.tabId,
        secondTabId: secondConnection.tabId,
      },
    )
    expect(connectedTabWindows).toEqual({
      firstWindowId: firstConnection.windowId,
      secondWindowId: secondConnection.windowId,
    })

    const groupsWhileConnected = await readGroups()
    expect(groupsWhileConnected.find((group) => group.id === userGroup.groupId)).toEqual({
      id: userGroup.groupId,
      windowId: userGroup.windowId,
      title: 'Travel Browser',
      color: 'red',
      collapsed: true,
      tabIds: [userGroup.tabId],
    })

    const firstOwnedGroup = groupsWhileConnected.find(
      (group) => group.id !== userGroup.groupId && group.windowId === firstConnection.windowId,
    )
    const secondOwnedGroup = groupsWhileConnected.find(
      (group) => group.id !== userGroup.groupId && group.windowId === secondConnection.windowId,
    )
    expect(firstOwnedGroup).toMatchObject({
      title: 'Travel Browser',
      color: 'cyan',
      tabIds: [firstConnection.tabId],
    })
    expect(secondOwnedGroup).toMatchObject({
      title: 'Travel Browser',
      color: 'cyan',
      tabIds: [secondConnection.tabId],
    })

    if (!secondOwnedGroup) throw new Error('Missing second owned group')
    // A group remembered by the extension can still carry the previous build's
    // title. Reconciliation must restyle that exact group without adopting a
    // user-created group with either the old or new display name.
    const legacy = await serviceWorker.evaluate(
      async ({ windowId, ownedGroupId }) => {
        await chrome.tabGroups.update(ownedGroupId, { title: 'penguin-browser', collapsed: true })
        const userTab = await chrome.tabs.create({ windowId, url: 'about:blank', active: false })
        if (userTab.id === undefined) throw new Error('Missing legacy user tab')
        const userGroupId = await chrome.tabs.group({ tabIds: [userTab.id], createProperties: { windowId } })
        await chrome.tabGroups.update(userGroupId, { title: 'penguin-browser', color: 'red', collapsed: true })
        await chrome.windows.update(windowId, { focused: true })
        const taskTab = await chrome.tabs.create({ windowId, url: 'about:blank', active: true })
        if (taskTab.id === undefined) throw new Error('Missing task tab')
        const connected = await globalThis.toggleExtensionForActiveTab()
        if (!connected.isConnected) throw new Error('Task tab did not connect')
        return { userGroupId, userTabId: userTab.id, taskTabId: taskTab.id }
      },
      { windowId: secondConnection.windowId, ownedGroupId: secondOwnedGroup.id },
    )

    await expect
      .poll(async () => (await readGroups()).find((group) => group.id === secondOwnedGroup.id))
      .toMatchObject({
        title: 'Travel Browser',
        color: 'cyan',
        tabIds: [secondConnection.tabId, legacy.taskTabId].sort((a, b) => a - b),
      })
    const legacyUserGroup = {
      id: legacy.userGroupId,
      windowId: secondConnection.windowId,
      title: 'penguin-browser',
      color: 'red',
      collapsed: true,
      tabIds: [legacy.userTabId],
    }
    expect((await readGroups()).find((group) => group.id === legacy.userGroupId)).toEqual(legacyUserGroup)

    const ownedGroupIds = [firstOwnedGroup?.id, secondOwnedGroup?.id].filter((id): id is number => id !== undefined)
    expect(ownedGroupIds).toHaveLength(2)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })

    await expect
      .poll(
        async () => {
          const groups = await readGroups()
          return groups.filter((group) => ownedGroupIds.includes(group.id)).length
        },
        { timeout: 10000 },
      )
      .toBe(0)

    expect((await readGroups()).find((group) => group.id === legacy.userGroupId)).toEqual(legacyUserGroup)
    expect((await readGroups()).find((group) => group.id === userGroup.groupId)).toEqual({
      id: userGroup.groupId,
      windowId: userGroup.windowId,
      title: 'Travel Browser',
      color: 'red',
      collapsed: true,
      tabIds: [userGroup.tabId],
    })
  }, 120000)
})
