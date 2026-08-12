import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Locator, ElementHandle } from '@xmorse/playwright-core'
import type { ICDPSession } from './cdp-session.js'

export interface ReactSourceLocation {
  fileName: string | null
  lineNumber: number | null
  columnNumber: number | null
  componentName: string | null
}

export type ReactSerializedProp =
  | string
  | number
  | boolean
  | null
  | ReactSerializedProp[]
  | { [key: string]: ReactSerializedProp }

export interface ReactComponentHierarchyItem {
  componentName: string | null
  source: Omit<ReactSourceLocation, 'componentName'> | null
  props: ReactSerializedProp
}

export interface ReactComponentInfo {
  componentName: string | null
  source: Omit<ReactSourceLocation, 'componentName'> | null
  hierarchy: ReactComponentHierarchyItem[]
  props: ReactSerializedProp
}

type ReactInspectableValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | object
  | ((...args: never[]) => ReactInspectableValue)

type BrowserElement = object

interface BippySourceFrame {
  fileName?: string | null
  lineNumber?: number | null
  columnNumber?: number | null
  functionName?: string | null
}

interface BippyFiber {
  return?: BippyFiber | null
  type?: ReactInspectableValue
  memoizedProps?: ReactInspectableValue
}

interface BippyRuntime {
  getFiberFromHostInstance(el: BrowserElement): BippyFiber | null
  getSource(fiber: BippyFiber): Promise<BippySourceFrame | null>
  getOwnerStack(fiber: BippyFiber): Promise<BippySourceFrame[]>
  getDisplayName(type: ReactInspectableValue): string | null
  isCompositeFiber(fiber: BippyFiber): boolean
  normalizeFileName(fileName: string): string
  isSourceFile(fileName: string): boolean
}

declare global {
  var __bippy: BippyRuntime | undefined
}

let bippyCode: string | null = null

function getBippyCode(): string {
  if (bippyCode) {
    return bippyCode
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const bippyPath = path.join(currentDir, '..', 'dist', 'bippy.js')
  bippyCode = fs.readFileSync(bippyPath, 'utf-8')
  return bippyCode
}

async function getPageFromTarget(target: Locator | ElementHandle): Promise<Page> {
  if ('page' in target) {
    return target.page()
  }

  const frame = await target.ownerFrame()
  if (!frame) {
    throw new Error('Could not get frame from element handle')
  }
  return frame.page()
}

async function ensureBippy({ page, cdp }: { page: Page; cdp: ICDPSession }): Promise<void> {
  const hasBippy = await page.evaluate(() => {
    return !!globalThis.__bippy
  })

  if (hasBippy) {
    return
  }

  const code = getBippyCode()
  await cdp.send('Runtime.evaluate', { expression: code })
}

export async function getReactSource({
  locator,
  cdp: cdpSession,
}: {
  locator: Locator | ElementHandle
  cdp: ICDPSession
}): Promise<ReactSourceLocation | null> {
  const cdp = cdpSession
  const page = await getPageFromTarget(locator)
  await ensureBippy({ page, cdp })

  const evaluateReactSource = async (
    el: BrowserElement,
  ): Promise<(ReactSourceLocation & { _notFound?: undefined }) | { _notFound: 'fiber' | 'source' }> => {
    const bippy = globalThis.__bippy
    if (!bippy) {
      throw new Error('bippy not loaded')
    }

    // bippy.normalizeFileName strips "/app-pages-browser/" but not the parenthesized
    // form "/(app-pages-browser)/" that Next.js webpack actually uses. This strips
    // all webpack layer prefixes like (app-pages-browser), (ssr), (rsc), etc.
    const cleanName = (name: string): string => {
      let f = bippy.normalizeFileName(name)
      f = f.replace(/^\/?\([-\w]+\)\//, '')
      f = f.replace(/^\.\//, '')
      return f
    }

    const fiber = bippy.getFiberFromHostInstance(el)
    if (!fiber) {
      return { _notFound: 'fiber' as const }
    }

    const source = await bippy.getSource(fiber)
    if (source) {
      return {
        fileName: source.fileName ? cleanName(source.fileName) : null,
        lineNumber: source.lineNumber ?? null,
        columnNumber: source.columnNumber ?? null,
        componentName: source.functionName ?? bippy.getDisplayName(fiber.type) ?? null,
      }
    }

    const ownerStack = await bippy.getOwnerStack(fiber)
    for (const frame of ownerStack) {
      if (frame.fileName && bippy.isSourceFile(frame.fileName)) {
        return {
          fileName: cleanName(frame.fileName),
          lineNumber: frame.lineNumber ?? null,
          columnNumber: frame.columnNumber ?? null,
          componentName: frame.functionName ?? null,
        }
      }
    }

    return { _notFound: 'source' as const }
  }

  const resolveResult = (
    result: (ReactSourceLocation & { _notFound?: undefined }) | { _notFound: 'fiber' | 'source' },
  ): ReactSourceLocation | null => {
    if (result?._notFound) {
      if (result._notFound === 'fiber') {
        console.warn('[getReactSource] no fiber found - is this a React element?')
      } else {
        console.warn('[getReactSource] no source location found - is this a React dev build?')
      }
      return null
    }

    return result
  }

  if ('page' in locator) {
    return resolveResult(await locator.evaluate(evaluateReactSource))
  }

  return resolveResult(await locator.evaluate(evaluateReactSource))
}

export async function getReactComponentInfo({
  locator,
  cdp: cdpSession,
}: {
  locator: Locator | ElementHandle
  cdp: ICDPSession
}): Promise<ReactComponentInfo | null> {
  const cdp = cdpSession
  const page = await getPageFromTarget(locator)
  await ensureBippy({ page, cdp })

  const evaluateReactComponentInfo = async (el: BrowserElement): Promise<ReactComponentInfo | null> => {
    const bippy = globalThis.__bippy
    if (!bippy) {
      throw new Error('bippy not loaded')
    }

    // bippy.normalizeFileName strips "/app-pages-browser/" but not the parenthesized
    // form "/(app-pages-browser)/" that Next.js webpack actually uses. This strips
    // all webpack layer prefixes like (app-pages-browser), (ssr), (rsc), etc.
    const cleanName = (name: string): string => {
      let f = bippy.normalizeFileName(name)
      f = f.replace(/^\/?\([-\w]+\)\//, '')
      f = f.replace(/^\.\//, '')
      return f
    }

    const serializeReactValue = (
      value: ReactInspectableValue,
      options: { depth: number; seen: WeakSet<object> },
    ): ReactSerializedProp => {
      if (value === null) {
        return null
      }
      if (typeof value === 'string') {
        return value.length > 300 ? `${value.slice(0, 300)}…[truncated]` : value
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return value
      }
      if (typeof value === 'undefined') {
        return '[undefined]'
      }
      if (typeof value === 'function') {
        return '[function]'
      }
      if (typeof value === 'symbol') {
        return '[symbol]'
      }
      if (typeof value === 'bigint') {
        return `${value.toString()}n`
      }
      if (typeof value !== 'object') {
        return `[${typeof value}]`
      }
      const objectTag = Object.prototype.toString.call(value)
      if (objectTag.includes('Element]') || objectTag === '[object Window]' || objectTag === '[object Document]') {
        return '[dom-node]'
      }
      if (options.seen.has(value)) {
        return '[circular]'
      }
      if (options.depth >= 3) {
        return '[max-depth]'
      }

      options.seen.add(value)

      if (Array.isArray(value)) {
        const items = value.slice(0, 20).map((item) => {
          return serializeReactValue(item, { depth: options.depth + 1, seen: options.seen })
        })
        if (value.length > 20) {
          items.push(`…[${value.length - 20} more]`)
        }
        options.seen.delete(value)
        return items
      }

      const entries = Object.entries(value).slice(0, 20)
      const result: { [key: string]: ReactSerializedProp } = Object.fromEntries(
        entries.map(([key, childValue]) => {
          return [key, serializeReactValue(childValue, { depth: options.depth + 1, seen: options.seen })]
        }),
      )
      const totalKeys = Object.keys(value).length
      if (totalKeys > 20) {
        result['…'] = `[${totalKeys - 20} more keys]`
      }
      options.seen.delete(value)
      return result
    }

    const getSourceForFiber = async (fiber: BippyFiber): Promise<Omit<ReactSourceLocation, 'componentName'> | null> => {
      try {
        const source = await bippy.getSource(fiber)
        if (source?.fileName) {
          return {
            fileName: cleanName(source.fileName),
            lineNumber: source.lineNumber ?? null,
            columnNumber: source.columnNumber ?? null,
          }
        }

        const ownerStack = await bippy.getOwnerStack(fiber)
        const frame = ownerStack.find((ownerFrame) => {
          return ownerFrame.fileName ? bippy.isSourceFile(ownerFrame.fileName) : false
        })
        if (frame?.fileName) {
          return {
            fileName: cleanName(frame.fileName),
            lineNumber: frame.lineNumber ?? null,
            columnNumber: frame.columnNumber ?? null,
          }
        }
      } catch {
        return null
      }

      return null
    }

    let fiber: BippyFiber | null = null
    try {
      fiber = bippy.getFiberFromHostInstance(el)
    } catch {
      return null
    }

    if (!fiber) {
      return null
    }

    const componentFibers: BippyFiber[] = []
    let current: BippyFiber | null | undefined = fiber
    while (current && componentFibers.length < 20) {
      try {
        if (bippy.isCompositeFiber(current)) {
          componentFibers.push(current)
        }
      } catch {
        // Ignore malformed or unsupported fibers and keep walking upward.
      }
      current = current.return
    }

    if (componentFibers.length === 0) {
      return null
    }

    const hierarchy = await Promise.all(
      componentFibers.map(async (componentFiber): Promise<ReactComponentHierarchyItem> => {
        const componentName = (() => {
          try {
            return componentFiber.type ? bippy.getDisplayName(componentFiber.type) : null
          } catch {
            return null
          }
        })()

        return {
          componentName,
          source: await getSourceForFiber(componentFiber),
          props: serializeReactValue(componentFiber.memoizedProps, { depth: 0, seen: new WeakSet<object>() }),
        }
      }),
    )

    const nearest = hierarchy[0]
    if (!nearest) {
      return null
    }

    return {
      componentName: nearest.componentName,
      source: nearest.source,
      hierarchy,
      props: nearest.props,
    }
  }

  if ('page' in locator) {
    return await locator.evaluate(evaluateReactComponentInfo)
  }

  return await locator.evaluate(evaluateReactComponentInfo)
}
