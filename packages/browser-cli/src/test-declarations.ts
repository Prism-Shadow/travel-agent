import type { ExtensionState } from 'penguin-browser-extension/src/types.js'

declare global {
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  var getExtensionState: () => ExtensionState
  var disconnectEverything: () => Promise<void>

  // Browser globals used in evaluate() calls
  var window: any
  var document: any
}

export {}
