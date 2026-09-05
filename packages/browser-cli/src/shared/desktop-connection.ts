/** Native-host protocol. Browser-safe: no Node imports or executable commands. */
export const NATIVE_HOST_NAME = 'com.prismshadow.travel_browser'
export const DESKTOP_CONNECTION_PROTOCOL = 1
export const TRAVEL_EXTENSION_ID = 'fbiciihmfbflenjjaphaljgfnlepnjdf'

export interface DesktopIdentity {
  installationId: string
  instanceId: string
  name: string
}

export interface DesktopEndpoint extends DesktopIdentity {
  protocol: 1
  port: number
  extensionKey: string
}

export type NativeRequest = { type: 'list' } | { type: 'connect'; installationId: string }
export type NativeResponse =
  | { protocol: 1; apps: DesktopIdentity[] }
  | { protocol: 1; endpoint: DesktopEndpoint }
  | { protocol: 1; error: string }

export function isDesktopEndpoint(value: unknown): value is DesktopEndpoint {
  if (!value || typeof value !== 'object') return false
  const v = value as DesktopEndpoint
  return v.protocol === DESKTOP_CONNECTION_PROTOCOL &&
    /^[a-f0-9]{32}$/.test(v.installationId) && /^[a-f0-9]{32}$/.test(v.instanceId) &&
    typeof v.name === 'string' && Number.isInteger(v.port) && v.port > 0 && v.port < 65536 &&
    /^[a-f0-9]{64}$/.test(v.extensionKey)
}
