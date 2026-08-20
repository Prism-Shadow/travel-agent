// The extension-state shape is the contract between this background worker and browser-cli's
// relay tests; it lives in browser-cli's shared layer so the dependency between the two
// packages points one way only (see extension-state.ts there for the full reasoning).
export type {
  ConnectionState,
  TabState,
  TabInfo,
  ExtensionState,
} from 'penguin-browser/src/shared/extension-state.js'

/**
 * Recording state - stored in service worker to track active recordings.
 * The actual MediaRecorder/MediaStream live in the offscreen document.
 */
export interface RecordingInfo {
  tabId: number
  startedAt: number
}
