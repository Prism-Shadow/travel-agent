import { startPenguinBrowserCDPRelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { waitForRelayVersion } from './relay-client.js'
import { LOG_CDP_FILE_PATH } from './utils.js'

process.title = 'penguin-browser-ws-server'

const logger = createFileLogger()

process.on('uncaughtException', async (err) => {
  await logger.error('Uncaught Exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', async (reason) => {
  await logger.error('Unhandled Rejection:', reason)
  process.exit(1)
})

process.on('exit', async (code) => {
  await logger.log(`Process exiting with code: ${code}`)
})

export async function startServer({
  port = 19989,
  host = '127.0.0.1',
  token,
}: { port?: number; host?: string; token?: string } = {}) {
  let server
  try {
    server = await startPenguinBrowserCDPRelayServer({ port, host, token, logger })
  } catch (err: unknown) {
    // When two relay processes race to start (issue #75), the loser gets
    // EADDRINUSE. Check if the winner is a valid relay and exit cleanly
    // instead of crashing with a scary error in the logs.
    const errWithCode = err as NodeJS.ErrnoException
    if (errWithCode?.code === 'EADDRINUSE') {
      // The winner may have bound the port but not be ready to answer /version
      // yet, so poll for up to 2 seconds before giving up.
      const version = await waitForRelayVersion({ port })
      if (version) {
        await logger.log(`Another relay (v${version}) already bound to port ${port}, exiting gracefully`)
        process.exit(0)
      }
      await logger.error(`Port ${port} is in use by a non-relay process`)
      process.exit(1)
    }
    throw err
  }

  console.log('CDP Relay Server running. Press Ctrl+C to stop.')
  console.log('Logs are being written to:', logger.logFilePath)
  console.log('CDP logs are being written to:', LOG_CDP_FILE_PATH)

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    server.close()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\nShutting down...')
    server.close()
    process.exit(0)
  })

  return server
}
startServer().catch(logger.error)
