import type { Page, Locator } from '@xmorse/playwright-core'
import type { ICDPSession } from '../relay/cdp-session.js'
import type { Debugger } from '../page/debugger.js'
import type { Editor } from '../page/editor.js'
import type { StylesResult } from '../page/styles.js'

export declare const page: Page
export declare const getCDPSession: (options: { page: Page }) => Promise<ICDPSession>
export declare const createDebugger: (options: { cdp: ICDPSession }) => Debugger
export declare const createEditor: (options: { cdp: ICDPSession }) => Editor
export declare const getStylesForLocator: (options: {
  locator: Locator
  includeUserAgentStyles?: boolean
}) => Promise<StylesResult>
export declare const formatStylesAsText: (styles: StylesResult) => string
export declare const console: { log: (...args: unknown[]) => void }
