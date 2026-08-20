/**
 * The extension's observable state — the contract between the browser extension's background
 * service worker (which produces it) and this package's relay tests (which assert on it via the
 * TESTING globals in test-declarations.ts).
 *
 * It lives on this side of the boundary, not in the extension, because the dependency between
 * the two packages must point one way only: the extension already deep-imports
 * `penguin-browser/src/…`, and a browser-cli devDependency on the extension for one type made
 * the pair a workspace cycle — which stopped pnpm from ordering their builds, the ordering that
 * keeps the injected-copy sync ahead of the extension build.
 */
export type ConnectionState = 'idle' | 'connected' | 'extension-replaced'
export type TabState = 'connecting' | 'connected' | 'error'

export interface TabInfo {
  sessionId?: string
  targetId?: string
  state: TabState
  errorText?: string
  attachOrder?: number
  isRecording?: boolean
}

export interface ExtensionState {
  tabs: Map<number, TabInfo>
  connectionState: ConnectionState
  currentTabId: number | undefined
  preferredWindowId: number | undefined
  errorText: string | undefined
}
