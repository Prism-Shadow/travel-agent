/** Owned child entry: binds port zero and reports readiness over its parent's private stdout. */
import { startPenguinBrowserCDPRelayServer } from './relay/cdp-relay.js'
import { isDesktopEndpoint } from './shared/desktop-connection.js'
import { isPidAlive } from './relay/relay-discovery.js'
import { iabKeyFromEnv } from './relay/iab-key.js'
import { createFileLogger } from './shared/create-logger.js'

const ownerPid = Number(process.env.PENGUIN_RELAY_OWNER_PID)
const desktop = {
  protocol: 1 as const,
  installationId: process.env.PENGUIN_RELAY_INSTALLATION_ID ?? '',
  instanceId: process.env.PENGUIN_RELAY_INSTANCE_ID ?? '',
  name: process.env.PENGUIN_RELAY_NAME ?? 'Travel Agent',
  extensionKey: process.env.PENGUIN_EXTENSION_KEY ?? '',
}
if (!isDesktopEndpoint({ ...desktop, port: 1 }) || !isPidAlive(ownerPid)) {
  throw new Error('Desktop relay requires a live owner and valid launch identity')
}
process.title = 'travel-browser-desktop-relay'
const relay = await startPenguinBrowserCDPRelayServer({
  port: 0, host: '127.0.0.1', desktop, iabKey: iabKeyFromEnv(), logger: createFileLogger(),
})
process.stdout.write(`TRAVEL_RELAY_READY ${JSON.stringify({ port: relay.port, instanceId: desktop.instanceId })}\n`)
const stop = () => { relay.close(); process.exit(0) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
// Parent death must not leave another detached desktop relay behind.
setInterval(() => { if (!isPidAlive(ownerPid)) stop() }, 1000).unref()
