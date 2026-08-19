import { startPenguinBrowserCDPRelayServer } from '../src/relay/cdp-relay.js'

async function main() {
  const server = await startPenguinBrowserCDPRelayServer({ port: 19989 })

  console.log('Server running. Press Ctrl+C to stop.')
}

main().catch(console.error)
