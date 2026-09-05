declare const __TRAVEL_BROWSER_STANDALONE__: boolean
import {
  isDesktopEndpoint, type DesktopEndpoint, type DesktopIdentity, type NativeResponse,
} from 'penguin-browser/src/shared/desktop-connection'
import { NativeConnection } from './native-connection'

export type ConnectionChoice = { mode: 'desktop'; installationId?: string } | { mode: 'standalone' }
export const CONNECTION_CHOICE_KEY = 'travelBrowser.connection'
export interface RelayEndpoint { port: number; desktop?: DesktopEndpoint }

const nativeConnection = new NativeConnection()
export const nativeRequest = (request: object): Promise<NativeResponse> => nativeConnection.request(request)

export async function availableDesktops(): Promise<DesktopIdentity[]> {
  const result = await nativeRequest({ type: 'list' })
  if (result.protocol !== 1 || !('apps' in result)) throw new Error('Update Travel Agent and Travel Browser together.')
  return result.apps
}

export async function readConnectionChoice(): Promise<ConnectionChoice> {
  const saved = (await chrome.storage.local.get(CONNECTION_CHOICE_KEY))[CONNECTION_CHOICE_KEY] as ConnectionChoice | undefined
  if (saved?.mode === 'desktop' || saved?.mode === 'standalone') return saved
  return { mode: __TRAVEL_BROWSER_STANDALONE__ ? 'standalone' : 'desktop' }
}

/** A paired desktop never falls through to a standalone endpoint, even while it is closed. */
export async function resolveExtensionEndpoint(standalonePort: number): Promise<RelayEndpoint> {
  const choice = await readConnectionChoice()
  if (choice.mode === 'standalone') return { port: standalonePort }
  let installationId = choice.installationId
  if (!installationId) {
    const apps = await availableDesktops()
    if (apps.length === 0) throw new Error('Open Travel Agent Desktop to connect.')
    if (apps.length > 1) throw new Error('More than one Travel Agent is running. Choose an application in the extension connection settings.')
    installationId = apps[0]!.installationId
    await chrome.storage.local.set({ [CONNECTION_CHOICE_KEY]: { mode: 'desktop', installationId } })
  }
  const response = await nativeRequest({ type: 'connect', installationId })
  if ('error' in response) throw new Error(response.error)
  if (!('endpoint' in response) || !isDesktopEndpoint(response.endpoint) || response.endpoint.installationId !== installationId) {
    throw new Error('Travel Agent returned an incompatible connection. Update the app and extension together.')
  }
  return { port: response.endpoint.port, desktop: response.endpoint }
}

/** The URL carries only a launch id, so browser connection errors cannot log a credential. */
export function extensionSocketUrl(endpoint: RelayEndpoint): URL {
  const url = new URL(`ws://127.0.0.1:${endpoint.port}/extension`)
  if (endpoint.desktop) {
    url.searchParams.set('instanceId', endpoint.desktop.instanceId)
  }
  return url
}

/** Authenticate in the WebSocket handshake, outside URLs and application logs. */
export function extensionSocketProtocols(endpoint: RelayEndpoint): string[] {
  return endpoint.desktop ? ['travel-browser', `travel-auth.${endpoint.desktop.extensionKey}`] : []
}
