#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { goke, openInBrowser, isAgent } from 'goke'
import { z } from 'zod'
import pc from 'picocolors'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}
import { killPortProcess } from './browser/kill-port.js'
import { canEmitKittyGraphics, emitKittyImage } from './media/kitty-graphics.js'
import { VERSION, LOG_FILE_PATH, LOG_CDP_FILE_PATH, parseRelayHost } from './shared/utils.js'
import { packageRoot } from './shared/package-paths.js'
import {
  assertStandaloneBrowserModeAllowed,
  readBackendPreference,
  resolveBackendRequest,
  resolveRelayEndpoint,
  type BrowserBackendRequest,
  type StandaloneBrowserMode,
} from './relay/relay-discovery.js'
import { MISSING_IDENTITY_MESSAGE, readAgentIdentity } from './relay/agent-identity.js'
import { iabKeyFromEnv } from './relay/iab-key.js'
import {
  harnessChannel,
  requestUserInteraction,
  type RequestInteractionOptions,
} from './executor/user-interaction.js'
import {
  ensureRelayServer,
  RELAY_PORT,
  waitForConnectedExtensions,
  getExtensionOutdatedWarning,
  getExtensionStatus,
  type ExtensionStatus,
} from './relay/relay-client.js'
import { discoverChromeInstances, resolveDirectInput, type DiscoveredInstance } from './browser/chrome-discovery.js'
import { getCloudClient, loadCloudAuth, saveCloudAuth, CloudClient, buildLiveUrl } from './browser/cloud-client.js'
import type { SessionConnectionStatus } from './relay/session-lifecycle.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function printHttpError(response: Response): Promise<void> {
  const text = await response.text()
  try {
    const payload = JSON.parse(text) as {
      error?: string | { message?: string; recovery?: string[] }
    }
    if (typeof payload.error === 'object' && payload.error !== null && payload.error.message) {
      console.error(`Error: ${payload.error.message}`)
      for (const recovery of payload.error.recovery ?? []) {
        console.error(`  - ${recovery}`)
      }
      return
    }
    if (typeof payload.error === 'string') {
      console.error(`Error: ${payload.error}`)
      return
    }
  } catch {
    // The endpoint may return plain text for middleware and infrastructure errors.
  }
  console.error(`Error: ${response.status} ${text}`)
}

const cli = goke('penguin-browser')

cli
  .command(
    'browser start [binaryPath]',
    'Start Chromium or Chrome for Testing with the bundled Penguin Browser extension',
  )
  .hidden()
  .option('--user-data-dir <dir>', 'Persistent browser profile directory used for the managed browser')
  .option('--headless', 'Run the browser in headless mode')
  .option('--headed', 'Force headed mode even on Linux without DISPLAY/WAYLAND_DISPLAY')
  .option('--disable-sandbox', 'Disable the browser sandbox, useful on some VPS setups')
  .action(async (binaryPath, options) => {
    if (options.headless && options.headed) {
      console.error('Error: --headless and --headed cannot be used together.')
      process.exit(1)
    }

    try {
      // Avoid loading playwright-core during generic CLI startup/help. This command
      // is the only path that needs browser discovery and bundled extension launch.
      const [
        { getBrowserLaunchArgs, getDefaultBrowserUserDataDir, startBrowserProcess },
        { resolveBrowserExecutablePath, shouldUseHeadlessByDefault },
        { getBundledExtensionPath },
      ] = await Promise.all([
        import('./browser/browser-launch.js'),
        import('./browser/browser-config.js'),
        import('./shared/package-paths.js'),
      ])

      await ensureRelayServer({ logger: console })

      const browserPath = resolveBrowserExecutablePath({ browserPath: binaryPath })
      const extensionPath = getBundledExtensionPath()
      const userDataDir = path.resolve(options.userDataDir || getDefaultBrowserUserDataDir())
      const headless = options.headed ? false : options.headless ? true : shouldUseHeadlessByDefault()
      const args = getBrowserLaunchArgs({
        extensionPath,
        userDataDir,
        headless,
        noSandbox: options.disableSandbox,
      })

      const { pid } = startBrowserProcess({
        browserPath,
        args,
        userDataDir,
      })

      const connectedExtensions = await waitForConnectedExtensions({
        timeoutMs: 15000,
        pollIntervalMs: 250,
        logger: console,
      })

      console.log(`Browser started (pid ${pid}).`)
      console.log(`  Binary: ${browserPath}`)
      console.log(`  Extension: ${extensionPath}`)
      console.log(`  Profile: ${userDataDir}`)
      console.log(`  Mode: ${headless ? 'headless' : 'headed'}`)
      console.log('  Permissions: recording/tabCapture flags enabled')

      if (connectedExtensions.length > 0) {
        console.log('Penguin Browser extension connected to the relay server.')
        return
      }

      console.log('Browser started, but the extension has not connected yet.')
      console.log(`Check logs at: ${LOG_FILE_PATH}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli.command('browser install', 'Download Chrome for Testing for headless browser automation').action(async () => {
  try {
    const { installChrome } = await import('./browser/browser-install.js')
    await installChrome()
  } catch (error: any) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
})

const DEFAULT_EXEC_TIMEOUT = Number(process.env.PENGUIN_BROWSER_EXEC_TIMEOUT) || 10000

cli
  .command('', 'Start the MCP server or controls the browser with -e')
  .option('--host <host>', 'Remote relay server host to connect to (or use PENGUIN_BROWSER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option('-s, --session <name>', 'Session ID (required for -e, get one with `penguin-browser session new`)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit (see the bundled Penguin Browser skill for usage)')
  .option('-f, --file <path>', 'Execute JavaScript from a file and exit')
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option('--timeout [ms]', z.number().default(DEFAULT_EXEC_TIMEOUT).describe('Execution timeout in milliseconds'))
  .action(async (options) => {
    if (options.patchright) {
      process.env.PENGUIN_BROWSER_PATCHRIGHT = '1'
    }

    if (options.eval && options.file) {
      console.error('Error: -e and -f cannot be used together.')
      process.exit(1)
    }

    // If -e or -f flag is provided, execute code via relay server
    const code = (() => {
      if (options.eval) {
        return options.eval
      }
      if (options.file) {
        const filePath = path.resolve(options.file)
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File not found: ${filePath}`)
          process.exit(1)
        }
        return fs.readFileSync(filePath, 'utf-8')
      }
      return null
    })()

    if (code) {
      await executeCode({
        code,
        timeout: options.timeout || DEFAULT_EXEC_TIMEOUT,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }

    // Otherwise start the MCP server
    // For direct CDP in MCP mode, use PENGUIN_BROWSER_DIRECT env var
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

/**
 * Which relay this command talks to.
 *
 * Resolved the same way for every command, and that is the point. The desktop shell prefers the
 * conventional port but binds an ephemeral one when something else already owns it, and publishes
 * where it landed. If `session new --iab` followed that and `execute` did not, a session created on
 * the shell's relay would be executed against a different relay that has never heard of it — the
 * session id is a small integer, so the failure is "session 3 not found" rather than anything that
 * points at two relays.
 *
 * Precedence: an explicit host, then the environment, then the shell's published endpoint, then the
 * conventional port. A machine with no desktop app publishes nothing and lands on the default,
 * which is where a Chrome extension connects.
 */
async function getServerUrl(host?: string): Promise<string> {
  const endpoint = await resolveRelayEndpoint({
    defaultPort: RELAY_PORT,
    host,
    envHost: process.env.PENGUIN_BROWSER_HOST,
    envPort: process.env.PENGUIN_BROWSER_PORT,
  })
  const { httpBaseUrl } = parseRelayHost(endpoint.host, endpoint.port)
  return httpBaseUrl
}

// Centralized header builder so every CLI subcommand sends the token consistently.
// Falls back to PENGUIN_BROWSER_TOKEN env var when --token is not provided.
function buildAuthHeaders({ token, json }: { token?: string; json?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) {
    headers['Content-Type'] = 'application/json'
  }
  const effectiveToken = token || process.env.PENGUIN_BROWSER_TOKEN
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`
  }
  return headers
}

async function fetchExtensionsStatus({ host, token }: { host?: string; token?: string } = {}): Promise<
  ExtensionStatus[]
> {
  try {
    const serverUrl = await getServerUrl(host)
    const headers = buildAuthHeaders({ token })
    const response = await fetch(`${serverUrl}/extensions/status`, {
      signal: AbortSignal.timeout(2000),
      headers,
    })
    if (!response.ok) {
      const fallback = await fetch(`${serverUrl}/extension/status`, {
        signal: AbortSignal.timeout(2000),
        headers,
      })
      if (!fallback.ok) {
        return []
      }
      const fallbackData = (await fallback.json()) as {
        connected: boolean
        activeTargets: number
        browser: string | null
        profile: { email: string; id: string } | null
        penguinBrowserVersion?: string | null
      }
      if (!fallbackData?.connected) {
        return []
      }
      return [
        {
          extensionId: 'default',
          stableKey: undefined,
          browser: fallbackData?.browser,
          profile: fallbackData?.profile,
          activeTargets: fallbackData?.activeTargets,
          penguinBrowserVersion: fallbackData?.penguinBrowserVersion || null,
        },
      ]
    }
    const data = (await response.json()) as {
      extensions: ExtensionStatus[]
    }
    return data?.extensions || []
  } catch {
    return []
  }
}

async function executeCode(options: {
  code: string
  timeout: number
  sessionId?: string
  host?: string
  token?: string
}): Promise<void> {
  const { code, timeout, host, token } = options
  const cwd = process.cwd()
  const sessionId = options.sessionId ? String(options.sessionId) : process.env.PENGUIN_BROWSER_SESSION

  // Session is required
  if (!sessionId) {
    console.error('Error: -s/--session is required.')
    console.error('Always run `penguin-browser session new` first to get a session ID to use.')
    process.exit(1)
  }

  const serverUrl = await getServerUrl(host)

  // Ensure relay server is running (only for local)
  if (!host && !process.env.PENGUIN_BROWSER_HOST) {
    const restarted = await ensureRelayServer({ logger: console })
    if (restarted) {
      const connectedExtensions = await waitForConnectedExtensions({
        logger: console,
        timeoutMs: 10000,
        pollIntervalMs: 250,
      })
      if (connectedExtensions.length === 0) {
        console.error('Warning: Extension not connected. Commands may fail.')
      }
    }
  }

  // Warn once if extension is outdated
  const extensionStatus = await getExtensionStatus()
  const outdatedWarning = getExtensionOutdatedWarning(extensionStatus?.penguinBrowserVersion)
  if (outdatedWarning) {
    console.error(outdatedWarning)
  }

  // Build request URL with token if provided
  const executeUrl = `${serverUrl}/cli/execute`

  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: buildAuthHeaders({ token, json: true }),
      // The caller's current task rides along on every execution, not just on session creation.
      // Relay session ids are reusable integers, so a later task can name an earlier task's
      // session; the relay compares this against the session's owner and refuses the mismatch
      // rather than letting one task drive another's tabs.
      body: JSON.stringify({ sessionId, code, timeout, cwd, taskId: readAgentIdentity()?.taskId }),
    })

    if (!response.ok) {
      await printHttpError(response)
      process.exit(1)
    }

    const result = (await response.json()) as {
      text: string
      images: Array<{ data: string; mimeType: string }>
      screenshots: Array<{ path: string; base64: string; snapshot: string; labelCount: number }>
      isError: boolean
      isCloud?: boolean
    }

    // Print output
    if (result.text) {
      if (result.isError) {
        console.error(result.text)
      } else {
        console.log(result.text)
      }
    }

    // Emit images via Kitty Graphics Protocol when AGENT_GRAPHICS=kitty.
    // Agents with kitty-graphics-agent intercept these escape sequences and pass
    // the PNG images to the LLM as media parts — no extra tool call needed.
    const kittyEnabled = canEmitKittyGraphics()

    // Track emitted base64 to avoid duplicates (screenshots appear in both
    // result.screenshots and result.images from the same screenshotCollector)
    const emittedImages = new Set<string>()

    if (result.screenshots && result.screenshots.length > 0) {
      for (const s of result.screenshots) {
        if (kittyEnabled && s.base64) {
          emitKittyImage({ base64: s.base64 })
          emittedImages.add(s.base64)
        }
        console.log(`\nScreenshot saved to: ${s.path}`)
        console.log(`Labels shown: ${s.labelCount}\n`)
        console.log(`Accessibility snapshot:\n${s.snapshot}`)
      }
    }

    // Emit resized images from resizeImageForAgent() calls that aren't
    // already emitted as part of labeled screenshots
    if (kittyEnabled && result.images && result.images.length > 0) {
      for (const img of result.images) {
        if (img.data && !emittedImages.has(img.data)) {
          emitKittyImage({ base64: img.data })
          emittedImages.add(img.data)
        }
      }
    }

    if (result.isCloud) {
      console.error(pc.dim(`\nCloud session. Run \`penguin-browser session delete ${sessionId}\` when done.`))
    }

    if (result.isError) {
      process.exit(1)
    }
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Error: Cannot connect to relay server.')
      console.error('The Penguin Browser relay server should start automatically. Check logs at:')
      console.error(`  ${LOG_FILE_PATH}`)
    } else {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

// Session management commands
// Unified browser option type used in the multi-browser selection table
interface BrowserOption {
  key: string
  type: 'extension' | 'direct' | 'cloud' | 'headless'
  browser: string
  profile: string
  /** For extension entries */
  extensionId?: string | null
  /** For direct CDP entries */
  wsUrl?: string
  /** Raw profile data from discovery (for passing to relay) */
  profiles?: Array<{ name: string; email: string }>
  /** For cloud entries — active BU session's cloud session ID (if VM is running) */
  activeCloudSessionId?: string
}

function parseBackendRequest(value: unknown): BrowserBackendRequest {
  if (value === undefined) return 'auto'
  if (value === 'auto' || value === 'iab' || value === 'extension') return value
  throw new Error(`Unknown browser backend "${String(value)}". Use auto, iab, or extension.`)
}

cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option(
    '--browser <key>',
    'Browser key when multiple browsers are available. Special values: "headless" (launch headless Chrome, no extension), "cloud" (cloud browser with stealth/proxies)',
  )
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option(
    '--direct [endpoint]',
    'Use direct CDP connection without the extension. Enable debugging first at chrome://inspect/#remote-debugging or launch Chrome with --remote-debugging-port=9222. Auto-discovers instances or accepts an explicit ws:// endpoint',
  )
  .option(
    '--proxy <region>',
    'Enable residential proxy for cloud browser (e.g. us, de, jp). Disabled by default. Use for anti-detection or geo-targeting.',
  )
  .option(
    '--iab',
    "Deprecated alias for --backend iab. The per-conversation choice still takes precedence.",
  )
  .option(
    '--backend <backend>',
    'Browser backend: auto (the conversation choice), iab, or extension. Default: auto.',
  )
  .option('--custom-proxy <url>', 'Custom proxy for cloud browser (host:port or user:pass@host:port)')
  .option('--timeout <minutes>', 'Cloud browser timeout in minutes (1-240, default 60)')
  .option(
    '--disable-proxy-bandwidth-acceleration',
    'Allow loading images, video, and fonts when proxy is enabled (they are blocked by default to save proxy bandwidth)',
  )
  .action(async (options) => {
    if (options.patchright) {
      process.env.PENGUIN_BROWSER_PATCHRIGHT = '1'
    }

    const isLocal = !options.host && !process.env.PENGUIN_BROWSER_HOST

    const identity = readAgentIdentity()
    const backendPreference = identity ? readBackendPreference(identity.sessionId) : null
    let backendOption: BrowserBackendRequest
    try {
      backendOption = parseBackendRequest(options.backend)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }

    if (options.iab && options.backend !== undefined) {
      console.error('Use either --iab or --backend, not both.')
      process.exit(1)
    }
    if (options.browser && (options.iab || backendOption === 'iab')) {
      console.error('A concrete --browser selects Chrome and cannot be combined with the IAB backend.')
      process.exit(1)
    }

    const specialModes: StandaloneBrowserMode[] = []
    if (options.browser === 'headless') specialModes.push('headless')
    if (typeof options.browser === 'string' && options.browser.startsWith('cloud')) {
      specialModes.push('cloud')
    }
    if (typeof options.browser === 'string' && options.browser.startsWith('direct:')) {
      specialModes.push('direct')
    }
    if (options.direct !== undefined) specialModes.push('direct')
    if (specialModes.length > 1) {
      console.error('Choose only one of headless, cloud, or direct CDP mode.')
      process.exit(1)
    }
    const specialMode = specialModes[0] ?? null
    const specialBrowser = specialMode !== null
    if (specialBrowser && (options.iab || options.backend !== undefined)) {
      console.error('--backend/--iab cannot be combined with headless, cloud, or direct CDP mode.')
      process.exit(1)
    }
    if (specialMode !== null) {
      try {
        assertStandaloneBrowserModeAllowed(backendPreference, specialMode)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    }

    let selectedBackend: 'iab' | 'extension' | null = null
    if (!specialBrowser) {
      // Naming a concrete browser key is an explicit extension request. `--backend auto` does not
      // turn that back into IAB; the recorded conversation choice still has authority below.
      const requested: BrowserBackendRequest = options.iab
        ? 'iab'
        : options.browser
          ? backendOption === 'iab'
            ? 'iab'
            : 'extension'
          : backendOption
      try {
        selectedBackend = resolveBackendRequest({
          requested,
          preference: backendPreference,
        })
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    }

    // IAB: the desktop shell's WebContentsView. Auto mode reaches this branch from the explicit
    // per-conversation preference Desktop writes before the task starts.
    if (selectedBackend === 'iab') {
      // Resolved before anything is opened. A tab belongs to a conversation and to a task, and
      // neither can be inferred here — refusing now produces one clear message instead of a
      // session whose first `tabs.open()` fails for a reason nothing explains.
      if (!identity) {
        console.error(MISSING_IDENTITY_MESSAGE)
        process.exit(1)
      }

      try {
        // The desktop shell prefers 19989 but moves to a dynamic port when something else already
        // owns it, so the port is discovered rather than assumed. A named host always wins, and on
        // that path discovery is neither read nor cleaned — it describes this machine, not the one
        // the caller pointed at.
        const endpoint = await resolveRelayEndpoint({
          defaultPort: 19989,
          host: options.host,
          envHost: process.env.PENGUIN_BROWSER_HOST,
          envPort: process.env.PENGUIN_BROWSER_PORT,
        })
        const serverUrl = parseRelayHost(endpoint.host, endpoint.port).httpBaseUrl
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({
            iab: true,
            cwd: process.cwd(),
            sessionId: identity.sessionId,
            taskId: identity.taskId,
          }),
        })
        const payload = (await response.json().catch(() => ({}))) as {
          id?: string
          browser?: string
          error?: { message?: string; recovery?: string[] } | string
        }
        if (!response.ok) {
          const error = payload.error
          const message = typeof error === 'string' ? error : (error?.message ?? 'Unknown error')
          console.error(message)
          if (typeof error === 'object' && error?.recovery) {
            console.error('')
            for (const step of error.recovery) console.error(`  - ${step}`)
          }
          process.exit(1)
        }
        console.log(`Created session ${payload.id} (in-app browser)`)
        return
      } catch (error) {
        console.error('Failed to create an in-app browser session:', (error as Error).message)
        process.exit(1)
      }
    }

    // --browser headless: launch headless Chrome via chromium.launch(), no extension
    if (options.browser === 'headless') {
      try {
        await ensureRelayForSessionCreation(isLocal)
        const serverUrl = await getServerUrl(options.host)
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({ headless: true, cwd: process.cwd() }),
        })
        if (!response.ok) {
          const text = await response.text()
          if (text.includes('Could not find a supported browser binary')) {
            console.error('No Chrome browser found. Install one first:')
            console.error('')
            console.error('  penguin-browser browser install')
            console.error('')
            console.error('This downloads Chrome for Testing from Google.')
            process.exit(1)
          }
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string }
        console.log(`Session ${result.id} created (headless). Use with: penguin-browser -s ${result.id} -e "..."`)
        console.log(pc.dim('NOTE: Recording unavailable in headless mode.'))
      } catch (error: any) {
        if (error.message?.includes('Could not find a supported browser binary')) {
          console.error('No Chrome browser found. Install one first:')
          console.error('')
          console.error('  penguin-browser browser install')
          console.error('')
          console.error('This downloads Chrome for Testing from Google.')
          process.exit(1)
        }
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }
    // goke 6.6: optional-value flags are string | undefined
    //   `--direct ws://...` → 'ws://...' (explicit endpoint)
    //   `--direct`          → ''          (bare flag, auto-discover)
    //   (omitted)           → undefined   (don't use direct CDP)
    const directEndpoint = options.direct || null

    // If --direct with explicit endpoint, resolve it (handles host:port → ws://) then skip discovery
    if (directEndpoint) {
      let cdpEndpoint: string
      try {
        cdpEndpoint = await resolveDirectInput(directEndpoint)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      const serverUrl = await getServerUrl(options.host)
      const result = await createDirectSession({ serverUrl, cdpEndpoint, token: options.token })
      console.log(`Session ${result.id} created (direct CDP). Use with: penguin-browser -s ${result.id} -e "..."`)
      console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
      return
    }

    // If --direct with no endpoint, discover Chrome instances
    if (options.direct === '') {
      if (!isLocal) {
        console.error('Error: --direct auto-discovery only works locally.')
        console.error('For remote relay, pass an explicit endpoint reachable from the relay host:')
        console.error('  penguin-browser session new --host <host> --direct ws://relay-host:9222/devtools/browser/...')
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      console.log(pc.dim('Discovering Chrome instances with debugging enabled...'))
      const instances = await discoverChromeInstances()

      if (instances.length === 0) {
        console.error('No Chrome instances with debugging enabled found.')
        console.error('')
        console.error('Enable debugging in one of these ways:')
        console.error('  1. Open chrome://inspect/#remote-debugging in Chrome')
        console.error('  2. Launch Chrome with: chrome --remote-debugging-port=9222')
        process.exit(1)
      }

      if (instances.length === 1 && !options.browser) {
        const instance = instances[0]
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({
          serverUrl,
          cdpEndpoint: instance.wsUrl,
          browser: instance.browser,
          profiles: instance.profiles,
          token: options.token,
        })
        const profileLabel = formatInstanceProfiles(instance)
        console.log(
          `Session ${result.id} created (direct CDP, ${instance.browser}${profileLabel}). Use with: penguin-browser -s ${result.id} -e "..."`,
        )
        console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      // Multiple instances or --browser specified
      const directOptions = instances.map((instance) => {
        return instanceToBrowserOption(instance)
      })

      if (options.browser) {
        const selected = directOptions.find((opt) => {
          return opt.key === options.browser
        })
        if (!selected) {
          await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: false })
          console.error(`Browser not found: ${options.browser}`)
          console.error('Available: ' + directOptions.map((opt) => opt.key).join(', '))
          process.exit(1)
        }
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({
          serverUrl,
          cdpEndpoint: selected.wsUrl!,
          browser: selected.browser,
          profiles: selected.profiles,
          token: options.token,
        })
        console.log(`Session ${result.id} created (direct CDP). Use with: penguin-browser -s ${result.id} -e "..."`)
        console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      printBrowserTable(directOptions)
      console.log('\nRun again with --browser <key>.')
      process.exit(1)
    }

    // Default mode: extension-based (existing behavior)
    let extensions: ExtensionStatus[] = []

    if (isLocal) {
      await ensureRelayServer({ logger: console })
      extensions = await waitForConnectedExtensions({
        timeoutMs: 12000,
        pollIntervalMs: 250,
        logger: console,
      })

      if (extensions.length === 0) {
        console.log(pc.dim('Waiting briefly for extension to reconnect...'))
        extensions = await waitForConnectedExtensions({
          timeoutMs: 10000,
          pollIntervalMs: 250,
          logger: console,
        })
      }
    } else {
      extensions = await fetchExtensionsStatus({ host: options.host, token: options.token })
    }

    if (extensions.length === 0) {
      // Cloud is a standalone/developer alternative, never a fallback from the browser explicitly
      // selected for a Desktop conversation.
      const cloudOptions = backendPreference === null ? await discoverCloudBrowsers() : []
      if (cloudOptions.length > 0) {
        // Cloud-only user: skip extension requirement, show cloud options
        await ensureRelayForSessionCreation(isLocal)
        const allOptions: BrowserOption[] = [...cloudOptions]

        if (options.browser) {
          const selected = allOptions.find((opt) => {
            return opt.key === options.browser
          })
          if (!selected) {
            await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: true })
            console.error(`Browser not found: ${options.browser}`)
            console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
            process.exit(1)
          }
          const serverUrl = await getServerUrl(options.host)
          // Reuse existing running VM if selected, otherwise create new
          const result = selected.activeCloudSessionId
            ? await attachExistingCloudSession({
                serverUrl,
                cloudSessionId: selected.activeCloudSessionId,
                blockProxyResources: computeBlockProxyResources(options),
                token: options.token,
              })
            : await createCloudSession({
                serverUrl,
                proxyRegion: options.proxy,
                customProxy: options.customProxy,
                timeout: parseCloudTimeout(options.timeout),
                blockProxyResources: computeBlockProxyResources(options),
                token: options.token,
              })
          console.log(`Session ${result.id} created (cloud). Use with: penguin-browser -s ${result.id} -e "..."`)
          if (result.liveUrl) {
            console.log(pc.dim(`Live view: ${result.liveUrl}`))
          }
          return
        }

        console.log('\nNo local browsers detected, but cloud browsers are available:\n')
        printBrowserTable(allOptions)
        console.log('\nRun again with --browser <key>.')
        process.exit(1)
      }

      if (options.browser) {
        await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: false })
      }
      console.error(
        'No Chrome extension is connected. Open Chrome or finish extension setup from the Browser menu.',
      )
      console.error(
        pc.dim('Click the extension icon only when this task needs a specific tab you already opened.'),
      )
      if (backendPreference === null) {
        console.error(pc.dim('Tip: Use --direct to connect via Chrome DevTools Protocol instead.'))
        console.error(
          pc.dim(
            'Tip: Cloud browsers require a configured private deployment; see `penguin-browser cloud login --help`.',
          ),
        )
      } else {
        console.error(
          pc.dim('Keep Chrome selected and finish setup, or choose IAB in the Browser menu between tasks.'),
        )
      }
      process.exit(1)
    }

    // Warn if any connected extension was built with an older penguin-browser version
    for (const ext of extensions) {
      const warning = getExtensionOutdatedWarning(ext.penguinBrowserVersion)
      if (warning) {
        console.error(warning)
        break
      }
    }

    // Single extension: auto-select (unchanged behavior)
    if (extensions.length === 1 && !options.browser) {
      const selectedExtension = extensions[0]
      try {
        const serverUrl = await getServerUrl(options.host)
        const extensionId =
          selectedExtension.extensionId === 'default'
            ? null
            : selectedExtension.stableKey || selectedExtension.extensionId
        const cwd = process.cwd()
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({ extensionId, cwd }),
        })
        if (!response.ok) {
          const text = await response.text()
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string; extensionId: string | null }
        console.log(`Session ${result.id} created. Use with: penguin-browser -s ${result.id} -e "..."`)
        printCloudTip()
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Multiple extensions: also discover direct CDP instances and cloud browsers.
    // Direct discovery only works locally — remote relay can't reach local Chrome debug ports.
    const directInstances = backendPreference === null && isLocal
      ? await (async () => {
          console.log(pc.dim('Discovering additional Chrome instances...'))
          return await discoverChromeInstances()
        })()
      : []

    // A Desktop conversation exposes only the chosen product backend here. Standalone direct and
    // cloud browsers remain available to plain CLI/web use, but are neither offered nor accepted
    // as hidden alternatives to a conversation's Browser-menu choice.
    const cloudOptions = backendPreference === null ? await discoverCloudBrowsers() : []

    const allOptions: BrowserOption[] = [
      ...extensions.map((ext) => {
        return {
          key: ext.stableKey || ext.extensionId,
          type: 'extension' as const,
          browser: ext.browser || 'Chrome',
          profile: ext.profile?.email || '(not signed in)',
          extensionId: ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId,
        }
      }),
      ...directInstances.map((instance) => {
        return instanceToBrowserOption(instance)
      }),
      ...cloudOptions,
    ]

    if (options.browser) {
      const selected = allOptions.find((opt) => {
        return opt.key === options.browser
      })
      if (!selected) {
        await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: cloudOptions.length > 0 })
        console.error(`Browser not found: ${options.browser}`)
        console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
        process.exit(1)
      }

      try {
        const serverUrl = await getServerUrl(options.host)
        if (selected.type === 'cloud') {
          // Reuse existing running VM if selected, otherwise create new
          const result = selected.activeCloudSessionId
            ? await attachExistingCloudSession({
                serverUrl,
                cloudSessionId: selected.activeCloudSessionId,
                blockProxyResources: computeBlockProxyResources(options),
                token: options.token,
              })
            : await createCloudSession({
                serverUrl,
                proxyRegion: options.proxy,
                customProxy: options.customProxy,
                timeout: parseCloudTimeout(options.timeout),
                blockProxyResources: computeBlockProxyResources(options),
                token: options.token,
              })
          console.log(`Session ${result.id} created (cloud). Use with: penguin-browser -s ${result.id} -e "..."`)
          if (result.liveUrl) {
            console.log(pc.dim(`Live view: ${result.liveUrl}`))
          }
        } else if (selected.type === 'direct') {
          const result = await createDirectSession({
            serverUrl,
            cdpEndpoint: selected.wsUrl!,
            browser: selected.browser,
            profiles: selected.profiles,
            token: options.token,
          })
          console.log(`Session ${result.id} created (direct CDP). Use with: penguin-browser -s ${result.id} -e "..."`)
          console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        } else {
          const cwd = process.cwd()
          const response = await fetch(`${serverUrl}/cli/session/new`, {
            method: 'POST',
            headers: buildAuthHeaders({ token: options.token, json: true }),
            body: JSON.stringify({ extensionId: selected.extensionId, cwd }),
          })
          if (!response.ok) {
            const text = await response.text()
            console.error(`Error: ${response.status} ${text}`)
            process.exit(1)
          }
          const result = (await response.json()) as { id: string }
          console.log(`Session ${result.id} created. Use with: penguin-browser -s ${result.id} -e "..."`)
          printCloudTip()
        }
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Show unified table
    console.log('\nMultiple browsers detected:\n')
    printBrowserTable(allOptions)
    console.log('\nRun again with --browser <key>.')
    process.exit(1)
  })

async function ensureRelayForSessionCreation(isLocal: boolean): Promise<void> {
  if (isLocal) {
    await ensureRelayServer({ logger: console })
  }
}

async function createDirectSession({
  serverUrl,
  cdpEndpoint,
  browser,
  profiles,
  token,
}: {
  serverUrl: string
  cdpEndpoint: string
  browser?: string
  profiles?: Array<{ name: string; email: string }>
  token?: string
}): Promise<{ id: string }> {
  const cwd = process.cwd()
  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token, json: true }),
    body: JSON.stringify({ cdpEndpoint, cwd, browser, profiles }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  return (await response.json()) as { id: string }
}

function instanceToBrowserOption(instance: DiscoveredInstance): BrowserOption {
  return {
    key: `direct:${instance.port}`,
    type: 'direct',
    browser: instance.browser,
    profile: formatInstanceProfiles(instance),
    wsUrl: instance.wsUrl,
    profiles: instance.profiles,
  }
}

function formatInstanceProfiles(instance: DiscoveredInstance): string {
  if (instance.profiles.length === 0) {
    return '(unknown)'
  }
  return instance.profiles
    .map((p) => {
      return p.email ? `${p.name} (${p.email})` : p.name
    })
    .join(', ')
}

/** Discover cloud sessions from the website API, if logged in.
 *  Also adds a "cloud-new" option to create a new cloud browser. */
async function discoverCloudBrowsers(): Promise<BrowserOption[]> {
  const client = getCloudClient()
  if (!client) return []

  try {
    const { sessions } = await client.getStatus()
    const options: BrowserOption[] = sessions.map((s) => {
      return {
        key: `cloud-${s.index}`,
        type: 'cloud' as const,
        browser: 'Chromium',
        profile: `(running, expires ${new Date(s.timeoutAt).toLocaleTimeString()})`,
        activeCloudSessionId: s.cloudSessionId,
      }
    })
    // Always offer a "cloud-new" option to spin up a fresh VM
    options.push({
      key: 'cloud',
      type: 'cloud' as const,
      browser: 'Chromium',
      profile: '(new cloud browser)',
    })
    return options
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(pc.dim(`Cloud browser discovery failed: ${msg}`))
    return []
  }
}

/** Compute whether to block images/video/fonts for proxy bandwidth savings.
 *  Enabled by default when proxy or custom-proxy is set, disabled via
 *  --disable-proxy-bandwidth-acceleration. */
function computeBlockProxyResources(options: {
  proxy?: string
  customProxy?: string
  disableProxyBandwidthAcceleration?: boolean
}): boolean | undefined {
  const proxyEnabled = !!(options.proxy || options.customProxy)
  if (!proxyEnabled) return undefined // no proxy, no blocking needed
  if (options.disableProxyBandwidthAcceleration) return false
  return true
}

/** Check if user requested a cloud browser that isn't available.
 *  Shows helpful login/subscribe instructions instead of a generic "not found" error.
 *  @param hasCloudOptions whether any cloud options were discovered (to distinguish
 *         "not logged in" from "typo in cloud key") */
async function handleCloudBrowserNotFound(
  browserKey: string,
  { hasCloudOptions }: { hasCloudOptions: boolean },
): Promise<boolean> {
  if (!browserKey.startsWith('cloud')) return false
  // If cloud options exist, this is a typo (e.g. cloud-99) — let the
  // generic "Browser not found" message show the available list instead.
  if (hasCloudOptions) return false
  const auth = loadCloudAuth()
  if (!auth) {
    console.error('Cloud browsers require authentication.')
    console.error('')
    console.error('  Option 1: Ask your deployment operator for its base URL, then run:')
    console.error('            `penguin-browser cloud login --base-url https://<cloud-host>`')
    console.error('  Option 2: Set both PENGUIN_BROWSER_CLOUD_URL and an operator-provided PENGUIN_BROWSER_API_KEY')
    console.error('')
    console.error('  After the deployment operator enables access, run `penguin-browser session new --browser cloud`')
  } else {
    // Verify token is still valid with a quick API check
    const client = getCloudClient()
    const tokenValid = await (async () => {
      if (!client) return false
      try {
        await client.getStatus()
        return true
      } catch {
        return false
      }
    })()

    if (!tokenValid) {
      console.error('Cloud authentication expired. Please re-authenticate.')
      console.error('')
      console.error('  Run `penguin-browser cloud login` or set PENGUIN_BROWSER_API_KEY env var.')
    } else {
      console.error('No cloud browser sessions available.')
      console.error('')
      console.error('  You are logged in, but you may need an active subscription.')
      console.error('  Run `penguin-browser cloud subscribe` to manage your plan.')
      console.error('  Then run `penguin-browser session new --browser cloud` to start a cloud browser.')
    }
  }
  process.exit(1)
}

function printCloudTip(): void {
  console.log('')
  console.log(
    pc.dim(
      'Tip: Cloud integration is available only with a configured private deployment URL and operator-provided credentials.',
    ),
  )
  console.log(pc.dim('     See `penguin-browser cloud login --help` for the required configuration.'))
}

/** Parse a custom proxy string (host:port or user:pass@host:port) into an object. */
function parseCustomProxy(proxyStr: string): { host: string; port: number; username?: string; password?: string } {
  // Format: [user:pass@]host:port
  const atIdx = proxyStr.lastIndexOf('@')
  let hostPort: string
  let username: string | undefined
  let password: string | undefined

  if (atIdx !== -1) {
    const userPass = proxyStr.slice(0, atIdx)
    hostPort = proxyStr.slice(atIdx + 1)
    const colonIdx = userPass.indexOf(':')
    if (colonIdx !== -1) {
      username = userPass.slice(0, colonIdx)
      password = userPass.slice(colonIdx + 1)
    } else {
      username = userPass
    }
  } else {
    hostPort = proxyStr
  }

  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon === -1) {
    throw new Error(`Invalid proxy format: missing port in "${proxyStr}". Expected host:port or user:pass@host:port`)
  }
  const host = hostPort.slice(0, lastColon)
  const port = parseInt(hostPort.slice(lastColon + 1), 10)
  if (isNaN(port)) {
    throw new Error(`Invalid proxy port in "${proxyStr}"`)
  }

  return { host, port, username, password }
}

/** Parse and validate the --timeout CLI option (integer 1-240). */
function parseCloudTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new Error('--timeout must be an integer from 1 to 240')
  }
  const timeout = Number(value)
  if (timeout < 1 || timeout > 240) {
    throw new Error('--timeout must be between 1 and 240 minutes')
  }
  return timeout
}

/** Connect to a cloud browser and create a penguin-browser session via the relay. */
async function createCloudSession({
  serverUrl,
  proxyRegion,
  customProxy,
  timeout,
  blockProxyResources,
  token,
}: {
  serverUrl: string
  proxyRegion?: string
  customProxy?: string
  /** Cloud browser timeout in minutes (1-240, default 60) */
  timeout?: number
  /** Block images/video/fonts to save proxy bandwidth (default: true when proxy is enabled) */
  blockProxyResources?: boolean
  token?: string
}): Promise<{ id: string; liveUrl: string | null }> {
  const client = getCloudClient()
  if (!client) {
    throw new Error('Not logged in to cloud. Run `penguin-browser cloud login` first.')
  }

  const connectResult = await client.connect({
    proxyRegion,
    customProxy: customProxy ? parseCustomProxy(customProxy) : undefined,
    timeout,
  })

  if (!connectResult.cdpUrl) {
    throw new Error('Cloud browser returned no CDP URL. The VM may have failed to start.')
  }

  // Normalize https:// CDP URL to wss:// for the relay
  const cdpEndpoint = await resolveDirectInput(connectResult.cdpUrl)

  // Create a penguin-browser session via the relay using the CDP URL (same as --direct).
  // Also pass cloud metadata so the relay can track idle timeout and auto-disconnect.
  const auth = loadCloudAuth()!
  const cwd = process.cwd()
  let response: Response
  try {
    response = await fetch(`${serverUrl}/cli/session/new`, {
      method: 'POST',
      headers: buildAuthHeaders({ token, json: true }),
      body: JSON.stringify({
        cdpEndpoint,
        cwd,
        browser: 'Chromium (cloud)',
        cloud: {
          cloudSessionId: connectResult.cloudSessionId,
          cloudBaseUrl: auth.baseUrl,
          cloudToken: auth.token,
          timeoutAt: connectResult.timeoutAt,
          blockProxyResources,
        },
      }),
    })
  } catch (cause) {
    // Relay session creation failed — stop the cloud VM so we don't leak a paid resource
    await client.disconnect(connectResult.cloudSessionId).catch(() => {})
    throw new Error('Failed to create relay session', { cause })
  }

  if (!response.ok) {
    await client.disconnect(connectResult.cloudSessionId).catch(() => {})
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }

  return { id: result.id, liveUrl: connectResult.cdpUrl ? buildLiveUrl(connectResult.cdpUrl, auth.baseUrl) : null }
}

/** Reattach to an existing running cloud browser VM instead of creating a new one.
 *  Fetches the session's cdpUrl from the cloud API and creates a relay session. */
async function attachExistingCloudSession({
  serverUrl,
  cloudSessionId,
  blockProxyResources,
  token,
}: {
  serverUrl: string
  cloudSessionId: string
  blockProxyResources?: boolean
  token?: string
}): Promise<{ id: string; liveUrl: string | null }> {
  const client = getCloudClient()
  if (!client) {
    throw new Error('Not logged in to cloud. Run `penguin-browser cloud login` first.')
  }

  const session = await client.getSessionStatus(cloudSessionId)
  if (!session || session.status !== 'active') {
    throw new Error('Cloud session is no longer active. It may have timed out.')
  }
  if (!session.cdpUrl) {
    throw new Error('Cloud session has no CDP URL available.')
  }

  const cdpEndpoint = await resolveDirectInput(session.cdpUrl)
  const auth = loadCloudAuth()!
  const cwd = process.cwd()

  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token, json: true }),
    body: JSON.stringify({
      cdpEndpoint,
      cwd,
      browser: 'Chromium (cloud)',
      cloud: {
        cloudSessionId,
        cloudBaseUrl: auth.baseUrl,
        cloudToken: auth.token,
        timeoutAt: session.timeoutAt,
        blockProxyResources,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }

  return { id: result.id, liveUrl: session.cdpUrl ? buildLiveUrl(session.cdpUrl, auth.baseUrl) : null }
}

function printBrowserTable(options: BrowserOption[]): void {
  const typeLabels = options.map((opt) => {
    if (opt.type === 'direct') return '--direct'
    if (opt.type === 'cloud') return 'cloud'
    return opt.type
  })
  const keyWidth = Math.max(3, ...options.map((opt) => opt.key.length))
  const typeWidth = Math.max(4, ...typeLabels.map((t) => t.length))
  const browserWidth = Math.max(7, ...options.map((opt) => opt.browser.length))

  console.log(
    'KEY'.padEnd(keyWidth) + '  ' + 'TYPE'.padEnd(typeWidth) + '  ' + 'BROWSER'.padEnd(browserWidth) + '  ' + 'PROFILE',
  )
  console.log('-'.repeat(keyWidth + typeWidth + browserWidth + 20))
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]
    console.log(
      opt.key.padEnd(keyWidth) +
        '  ' +
        typeLabels[i].padEnd(typeWidth) +
        '  ' +
        opt.browser.padEnd(browserWidth) +
        '  ' +
        opt.profile,
    )
  }
}

cli
  .command('session list', 'List relay sessions and their browser connection status')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .action(async (options) => {
    if (!options.host && !process.env.PENGUIN_BROWSER_HOST) {
      await ensureRelayServer({ logger: console })
    }

    const serverUrl = await getServerUrl(options.host)
    let sessions: Array<{
      id: string
      stateKeys: string[]
      browser: string | null
      profile: { email: string; id: string } | null
      extensionId: string | null
      cwd: string | null
      connectionStatus: SessionConnectionStatus
    }> = []

    try {
      const response = await fetch(`${serverUrl}/cli/sessions`, {
        headers: buildAuthHeaders({ token: options.token }),
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        console.error(`Error: ${response.status} ${await response.text()}`)
        process.exit(1)
      }
      const result = (await response.json()) as {
        sessions: Array<{
          id: string
          stateKeys: string[]
          browser: string | null
          profile: { email: string; id: string } | null
          extensionId: string | null
          cwd: string | null
          connectionStatus: SessionConnectionStatus
        }>
      }
      sessions = result.sessions
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }

    if (sessions.length === 0) {
      console.log('No sessions')
      return
    }

    const idWidth = Math.max(2, ...sessions.map((session) => String(session.id).length))
    const statusLabel = (status: SessionConnectionStatus): string => {
      if (status === 'connected') return 'CONNECTED'
      if (status === 'disconnected') return 'DISCONNECTED'
      return 'N/A'
    }
    const statusWidth = Math.max(6, ...sessions.map((session) => statusLabel(session.connectionStatus).length))
    const browserWidth = Math.max(7, ...sessions.map((session) => (session.browser || 'Chrome').length))
    const profileWidth = Math.max(7, ...sessions.map((session) => (session.profile?.email || '').length || 1))
    const extensionWidth = Math.max(2, ...sessions.map((session) => (session.extensionId || '').length || 1))
    const cwdWidth = Math.max(3, ...sessions.map((session) => (session.cwd || '').length || 1))
    const stateWidth = Math.max(10, ...sessions.map((session) => session.stateKeys.join(', ').length || 1))

    console.log(
      'ID'.padEnd(idWidth) +
        '  ' +
        'STATUS'.padEnd(statusWidth) +
        '  ' +
        'BROWSER'.padEnd(browserWidth) +
        '  ' +
        'PROFILE'.padEnd(profileWidth) +
        '  ' +
        'EXT'.padEnd(extensionWidth) +
        '  ' +
        'CWD'.padEnd(cwdWidth) +
        '  ' +
        'STATE KEYS',
    )
    console.log(
      '-'.repeat(idWidth + statusWidth + browserWidth + profileWidth + extensionWidth + cwdWidth + stateWidth + 12),
    )

    for (const session of sessions) {
      const stateStr = session.stateKeys.length > 0 ? session.stateKeys.join(', ') : '-'
      const profileLabel = session.profile?.email || '-'
      const cwdLabel = session.cwd || '-'
      console.log(
        String(session.id).padEnd(idWidth) +
          '  ' +
          statusLabel(session.connectionStatus).padEnd(statusWidth) +
          '  ' +
          (session.browser || 'Chrome').padEnd(browserWidth) +
          '  ' +
          profileLabel.padEnd(profileWidth) +
          '  ' +
          (session.extensionId || '-').padEnd(extensionWidth) +
          '  ' +
          cwdLabel.padEnd(cwdWidth) +
          '  ' +
          stateStr,
      )
    }
  })

cli
  .command('session delete <sessionId>', 'Delete a session and clear its state')
  .option(
    '--outcome <outcome>',
    "How the task went, for the in-app browser's tab rules: read_only (nothing to come back to, its tabs close), committed (an order or a payment page — its tabs are kept), or failed. Omitted means unknown, which keeps them.",
  )
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .action(async (sessionId, options) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PENGUIN_BROWSER_HOST) {
      await ensureRelayServer({ logger: console })
    }

    try {
      // Validated here rather than passed through: an arbitrary string would be read as "unknown"
      // at the far end, so a typo would silently become the conservative rule and nobody would
      // learn the declaration never landed.
      const outcomes = ['read_only', 'committed', 'failed', 'unknown']
      if (options.outcome !== undefined && !outcomes.includes(options.outcome)) {
        console.error(`--outcome must be one of: ${outcomes.join(', ')}`)
        process.exit(1)
      }

      const response = await fetch(`${serverUrl}/cli/session/delete`, {
        method: 'POST',
        headers: buildAuthHeaders({ token: options.token, json: true }),
        // The task's identity travels with the request: deleting a session tears down an executor
        // another task may still be using. The outcome travels with it too — closing the browser
        // session is where the agent says how the task went, and the in-app browser's retain/close
        // rules have no other source for that.
        body: JSON.stringify({
          sessionId,
          taskId: readAgentIdentity()?.taskId,
          ...(options.outcome ? { outcome: options.outcome } : {}),
        }),
      })

      if (!response.ok) {
        const result = (await response.json()) as { error: string }
        console.error(`Error: ${result.error}`)
        process.exit(1)
      }

      console.log(`Session ${sessionId} deleted.`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session reset <sessionId>', 'Reset the browser connection for a session')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .action(async (sessionId, options) => {
    const cwd = process.cwd()
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PENGUIN_BROWSER_HOST) {
      await ensureRelayServer({ logger: console })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/reset`, {
        method: 'POST',
        headers: buildAuthHeaders({ token: options.token, json: true }),
        // Same ownership rule as execute and delete: resetting rebuilds another task's browser
        // connection underneath it if the session is not this task's.
        body: JSON.stringify({ sessionId, cwd, taskId: readAgentIdentity()?.taskId }),
      })

      if (!response.ok) {
        await printHttpError(response)
        process.exit(1)
      }

      const result = (await response.json()) as { success: boolean; pageUrl: string; pagesCount: number }
      console.log(
        `Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`,
      )
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

// ============================================================================
// Live RTMP streaming commands. These are sugar over the executor `stream`
// global (same execute path as -e), which resolves the session's current tab
// and calls the relay's /stream/* endpoints. ffmpeg runs inside the relay
// process, so the stream keeps running after the CLI exits.
// ============================================================================

cli
  .command(
    'stream start',
    'Stream the session tab live to RTMP destinations (X Live, Twitch, ...) via ffmpeg. Streams the current page - navigate first with -e "await page.goto(...)"',
  )
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID (get one with `penguin-browser session new`)')
  .option(
    '--rtmp <url>',
    z
      .union([z.string(), z.array(z.string())])
      .describe('RTMP destination URL with stream key (repeatable for simultaneous multi-streaming)'),
  )
  .option(
    '--resolution <WxH>',
    z.string().default('1920x1080').describe('Output resolution (default is X Live recommended)'),
  )
  .option('--fps <n>', z.number().default(30).describe('Output frame rate'))
  .option(
    '--video-bitrate <kbps>',
    z.number().default(9000).describe('Video bitrate in kbps (default is X Live recommended; Twitch max 6000)'),
  )
  .option('--audio-bitrate <kbps>', z.number().default(128).describe('Audio bitrate in kbps'))
  .option(
    '--keyframe-interval <seconds>',
    z.number().default(3).describe('Keyframe interval in seconds (3 = X Live recommended, 2 = Twitch)'),
  )
  .option('--no-audio', 'Do not capture tab audio (a silent track is injected, required by X Live)')
  .option('--preset <name>', z.string().default('veryfast').describe('x264 preset (only applies to libx264)'))
  .option('--codec <name>', 'Video codec for ffmpeg (default: auto-detect hardware encoder, falls back to libx264)')
  .action(async (options) => {
    const rtmpUrls: string[] = (() => {
      if (!options.rtmp) {
        return []
      }
      return Array.isArray(options.rtmp) ? options.rtmp : [options.rtmp]
    })()
    if (rtmpUrls.length === 0) {
      console.error('Error: at least one --rtmp destination is required.')
      console.error('Example: penguin-browser stream start -s 1 --rtmp rtmp://va.pscp.tv:80/x/<stream-key>')
      process.exit(1)
    }
    if (!/^\d+x\d+$/.test(options.resolution)) {
      console.error(`Error: invalid --resolution "${options.resolution}", expected WxH like 1920x1080`)
      process.exit(1)
    }

    const streamParams = {
      rtmpUrls,
      resolution: options.resolution,
      fps: options.fps,
      videoBitrateKbps: options.videoBitrate,
      audioBitrateKbps: options.audioBitrate,
      keyframeSeconds: options.keyframeInterval,
      audio: !options.noAudio,
      preset: options.preset,
      codec: options.codec,
    }

    // Run through the executor so the session's current tab is resolved and
    // ffmpeg is spawned inside the relay process (survives CLI exit).
    const code = [
      `const result = await stream.start(${JSON.stringify(streamParams)})`,
      `console.log('Streaming tab ' + result.tabId + ' to: ' + result.destinations.join(', '))`,
      `console.log('The stream runs until you call: penguin-browser stream stop -s <session>')`,
    ].join('\n')

    await executeCode({
      code,
      timeout: 60000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command('interaction request', 'Ask the person for one thing, and wait (design/003 §7)')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID')
  .option(
    '--kind <kind>',
    'info_request | selection | commitment_confirmation | secret_entry | human_challenge | browser_takeover',
  )
  .option('--ask <text>', 'What the person should do, as an instruction')
  .option('--summary <text>', 'One line of context (never a value)')
  .option('--options-json <json>', 'selection: [{ id, label, rationale, plan? }]')
  .option('--payment-json <json>', 'commitment_confirmation: the seven fields of the purchase')
  .option('--tolerance <amount>', 'commitment_confirmation: slack to OFFER on the card, in the same currency')
  .option('--field <field>', 'secret_entry: cvv | otp | three_d_secure | card_number | payment_password | passkey')
  .option('--purpose <text>', 'secret_entry: why the code is needed')
  .option('--target <selector>', 'human_challenge / browser_takeover: element to highlight')
  .option('--reason <text>', 'browser_takeover: why the other five kinds were not enough (required)')
  .option(
    '--timeout [ms]',
    z.number().default(120000).describe('How long to wait for the person, in milliseconds'),
  )
  .action(async (options) => {
    const kind = String(options.kind ?? '')
    const ask = String(options.ask ?? '')
    if (!kind || !ask) {
      console.error('Error: --kind and --ask are both required.')
      process.exit(1)
    }
    const timeoutMs = Number(options.timeout ?? 120000)
    const request: Record<string, unknown> = {
      kind,
      ask,
      summary: options.summary ? String(options.summary) : undefined,
      timeoutMs,
    }
    if (options.optionsJson) request.options = JSON.parse(String(options.optionsJson))
    if (options.paymentJson) request.payment = JSON.parse(String(options.paymentJson))
    if (options.tolerance) request.offeredTolerance = { amountIncrease: Number(options.tolerance) }
    if (options.field) request.field = String(options.field)
    if (options.purpose) request.purpose = String(options.purpose)
    if (options.target) request.targetSelector = String(options.target)
    if (options.reason) request.reason = String(options.reason)

    // The two page kinds run *through the executor*, so the overlay lands on the session's own tab
    // and the wait survives the navigation a solved captcha usually causes. The card kinds do not
    // touch the browser at all, so they are sent straight from here — going through the relay
    // would mean a browser session had to exist before the agent could ask a question.
    if (kind === 'human_challenge' || kind === 'browser_takeover') {
      const code = [
        `const result = await requestUserInteraction(${JSON.stringify(request)})`,
        `console.log(JSON.stringify(result))`,
      ].join('\n')
      await executeCode({
        code,
        timeout: timeoutMs + 30000,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }

    const result = await requestUserInteraction(request as unknown as RequestInteractionOptions)
    console.log(JSON.stringify(result))
    // An unanswered or refused request is not a CLI failure: the agent has to read the outcome and
    // decide. Only a request that could not be made at all exits non-zero.
    if (result.status === 'unavailable') process.exitCode = 2
  })

cli
  .command('payment authorize', 'Ask the harness whether this payment may proceed')
  .option('--plan-json <json>', 'What the payment page says right now (the same fields as the card)')
  .option('--action <name>', 'Stable action name for the journal, e.g. ctrip.payFlightOrder')
  .action(async (options) => {
    const channel = harnessChannel()
    if (!channel) {
      console.error(
        'This command needs a Travel Agent turn: the payment guard lives with the conversation.',
      )
      process.exit(2)
    }
    const response = await fetch(new URL('/api/agent/payments/authorize', channel.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${channel.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: channel.sessionId,
        actualPlan: JSON.parse(String(options.planJson ?? '{}')),
        action: String(options.action ?? 'payment'),
      }),
    })
    const body = await response.text()
    console.log(body)
    // A refusal is an outcome, not an error: the agent reports it to the person and stops.
    if (!response.ok) process.exitCode = 1
  })

cli
  .command('payment report', 'Tell the harness what an authorised payment actually did')
  .option('--authorization <id>', 'The authorizationId the guard returned')
  .option('--outcome-json <json>', 'What happened: order id, status, whatever the page showed')
  .action(async (options) => {
    const channel = harnessChannel()
    if (!channel) {
      console.error('This command needs a Travel Agent turn.')
      process.exit(2)
    }
    const response = await fetch(
      new URL(`/api/agent/payments/${String(options.authorization)}/outcome`, channel.baseUrl),
      {
        method: 'POST',
        headers: { authorization: `Bearer ${channel.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: channel.sessionId,
          outcome: JSON.parse(String(options.outcomeJson ?? '{}')),
        }),
      },
    )
    if (!response.ok) {
      console.error(await response.text())
      process.exitCode = 1
      return
    }
    console.log(JSON.stringify({ recorded: true }))
  })

cli
  // Kept as the shorthand for the commonest page handoff — a captcha, a code the site itself
  // consumes — and now expressed in terms of the six kinds: this is `human_challenge`. Anything
  // that does not need the person's hands *in the page* belongs in `interaction request` instead.
  .command('request-help', 'Hand the page to the person for one step (a human_challenge), then resume')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID')
  .option('--prompt <text>', 'What the human should do (write it as an instruction)')
  .option('--target <selector>', 'CSS selector to highlight and scroll into view')
  .option(
    '--timeout [ms]',
    z.number().default(120000).describe('How long to wait for the human, in milliseconds'),
  )
  .action(async (options) => {
    if (!options.prompt) {
      console.error('Error: --prompt is required (tell the human what to do).')
      process.exit(1)
    }
    const helpTimeout = Number(options.timeout ?? 120000)
    const params = {
      prompt: String(options.prompt),
      targetSelector: options.target ? String(options.target) : undefined,
      timeoutMs: helpTimeout,
    }
    // Runs through the executor so the overlay lands on the session's current tab and the wait
    // survives the navigation a solved captcha usually triggers.
    const code = [
      `const result = await requestUserInteraction(${JSON.stringify({
        kind: 'human_challenge',
        ask: params.prompt,
        targetSelector: params.targetSelector,
        timeoutMs: params.timeoutMs,
      })})`,
      `console.log(JSON.stringify(result))`,
    ].join('\n')

    await executeCode({
      code,
      // Must outlast the handoff itself, or the execute call would time out while the human is
      // still working; the overlay's own timeout is what actually bounds the wait.
      timeout: helpTimeout + 30000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command('stream stop', 'Stop the active stream for a session')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID')
  .action(async (options) => {
    const code = [
      `const result = await stream.stop()`,
      `console.log('Stream stopped after ' + Math.round(result.duration / 1000) + 's (' + result.bytesReceived + ' bytes captured)')`,
    ].join('\n')

    await executeCode({
      code,
      timeout: 60000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command('stream status', 'Show stream health: uptime, encoder fps, bitrate, dropped frames')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID')
  .action(async (options) => {
    const code = [
      `const status = await stream.status()`,
      `if (!status.streaming) {`,
      `  console.log('Not streaming' + (status.error ? '. Last stream error: ' + status.error : ''))`,
      `} else {`,
      `  const uptime = Math.round((Date.now() - status.startedAt) / 1000)`,
      `  console.log('Streaming tab ' + status.tabId + ' to: ' + status.destinations.join(', '))`,
      `  console.log('Uptime: ' + uptime + 's, received: ' + status.stats.bytesReceived + ' bytes (' + status.stats.chunksReceived + ' chunks)')`,
      `  if (status.stats.ffmpegFps !== undefined) {`,
      `    console.log('Encoder: ' + status.stats.ffmpegFps + ' fps, ' + (status.stats.ffmpegBitrateKbps || '?') + ' kbps, dropped: ' + (status.stats.droppedFrames ?? 0))`,
      `  }`,
      `}`,
    ].join('\n')

    await executeCode({
      code,
      timeout: 15000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command(
    'serve',
    `Start the relay server on this machine (must be the same host where Chrome is running). Remote clients (Docker, other machines) connect via PENGUIN_BROWSER_HOST. Use --host localhost for Docker (no token needed) — containers reach it via host.docker.internal. Use --host 0.0.0.0 for LAN/internet access (requires --token).`,
  )
  .option(
    '--host [host]',
    z.string().default('127.0.0.1').describe('Host to bind to (default: 127.0.0.1 for local-only access; use "localhost" for Docker; use "0.0.0.0" for LAN/internet access, requires --token)'),
  )
  .option(
    '--token <token>',
    'Authentication token, required when --host is 0.0.0.0 (or use PENGUIN_BROWSER_TOKEN env var)',
  )
  .option('--replace', 'Kill existing server if running')
  .action(async (options) => {
    const token = options.token || process.env.PENGUIN_BROWSER_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set PENGUIN_BROWSER_TOKEN environment variable.')
      process.exit(1)
    }

    // Expose the token to in-process callers (screen-recording.ts, etc.) so
    // they can attach Authorization: Bearer ... when calling the relay's own
    // privileged endpoints. Required because we no longer bypass auth for
    // loopback — see commit history for the tunnel-agent threat model.
    if (token) {
      process.env.PENGUIN_BROWSER_TOKEN = token
    }

    // Check if server is already running on the port
    const net = await import('node:net')
    const isPortInUse = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        resolve(false)
      })
      socket.connect(RELAY_PORT, '127.0.0.1')
    })

    if (isPortInUse) {
      if (!options.replace) {
        console.log(`Penguin Browser server is already running on port ${RELAY_PORT}`)
        console.log('Tip: Use --replace to kill the existing server and start a new one.')
        process.exit(0)
      }

      // Kill existing process on the port
      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      await killPortProcess({ port: RELAY_PORT })
    }

    // Lazy-load heavy dependencies only when serve command is used
    const { createFileLogger } = await import('./shared/create-logger.js')
    const { startPenguinBrowserCDPRelayServer } = await import('./relay/cdp-relay.js')

    const logger = createFileLogger()
    // The desktop shell passes this per-launch secret through the environment, never argv. The
    // background relay entry point reads it through the same helper; keeping the two paths unified
    // prevents `serve` from silently starting an IAB endpoint that rejects its own shell.
    const iabKey = iabKeyFromEnv()

    process.title = 'penguin-browser-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startPenguinBrowserCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      iabKey,
      logger,
    })

    console.log('Penguin Browser CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
    console.log(`  IAB: ${iabKey ? '(configured)' : '(disabled)'}`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log(`  CDP Logs: ${LOG_CDP_FILE_PATH}`)
    console.log('')
    console.log(`CDP endpoint: http://${options.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

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
  })

cli
  .command('browser list', 'List all available browsers: extension-connected and direct CDP on port 9222')
  .option('--host <host>', z.string().describe('Remote relay server host'))
  .option('--token <token>', 'Authentication token (or use PENGUIN_BROWSER_TOKEN env var)')
  .action(async (options) => {
    const isLocal = !options.host && !process.env.PENGUIN_BROWSER_HOST

    // Start relay if local so the extension can connect, then fetch in parallel
    if (isLocal) {
      await ensureRelayServer({ logger: console })
    }

    const [extensions, directInstances] = await Promise.all([
      isLocal
        ? waitForConnectedExtensions({ timeoutMs: 2000, pollIntervalMs: 200, logger: console })
        : fetchExtensionsStatus({ host: options.host, token: options.token }),
      isLocal ? discoverChromeInstances() : Promise.resolve([] as DiscoveredInstance[]),
    ])

    const cloudOptions = await discoverCloudBrowsers()

    // Check if a Chrome binary is available for headless mode
    const headlessOption: BrowserOption[] = await (async () => {
      try {
        const { resolveBrowserExecutablePath } = await import('./browser/browser-config.js')
        resolveBrowserExecutablePath()
        return [
          {
            key: 'headless',
            type: 'headless' as const,
            browser: 'Chrome (Headless)',
            profile: '-',
          },
        ]
      } catch {
        return []
      }
    })()

    const allOptions: BrowserOption[] = [
      ...extensions.map((ext) => {
        return {
          key: ext.stableKey || ext.extensionId,
          type: 'extension' as const,
          browser: ext.browser || 'Chrome',
          profile: ext.profile?.email || '(not signed in)',
          extensionId: ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId,
        }
      }),
      ...directInstances.map(instanceToBrowserOption),
      ...headlessOption,
      ...cloudOptions,
    ]

    if (allOptions.length === 0) {
      console.log('No browsers detected.\n')
      console.log('  Extension: click the Penguin Browser icon on a tab to connect')
      console.log('  Direct:    open chrome://inspect/#remote-debugging in Chrome')
      console.log('  Headless:  run `penguin-browser browser install` then `--browser headless`')
      console.log('  Cloud:     requires a configured private deployment (`penguin-browser cloud login --help`)')
      return
    }

    printBrowserTable(allOptions)
    console.log('')

    const hasDirectInstances = allOptions.some((opt) => {
      return opt.type === 'direct'
    })
    if (hasDirectInstances) {
      console.log(pc.dim('Connect with: penguin-browser session new --direct'))
      console.log(pc.dim('Chrome may ask to approve the debugging connection.'))
    } else {
      console.log(pc.dim('Use with: penguin-browser session new [--browser <key>]'))
    }

    const hasCloud = allOptions.some((opt) => {
      return opt.type === 'cloud'
    })
    if (!hasCloud) {
      printCloudTip()
    }
  })

// ── Cloud commands ──────────────────────────────────────────────────

cli
  .command('cloud login', 'Authenticate with a configured private Penguin Browser cloud deployment')
  .option('--base-url <url>', 'Cloud deployment base URL (or set PENGUIN_BROWSER_CLOUD_URL)')
  .action(async (options, ctx) => {
    const baseUrl = options.baseUrl || ctx.process.env.PENGUIN_BROWSER_CLOUD_URL
    if (!baseUrl) {
      ctx.console.error('Cloud login is not configured in this local-development build.')
      ctx.console.error('Ask the deployment operator for its base URL, then pass `--base-url <url>`')
      ctx.console.error('or set PENGUIN_BROWSER_CLOUD_URL. No public Penguin Browser cloud endpoint is provided.')
      ctx.process.exit(1)
      return
    }

    // Use the better-auth client SDK so we don't hardcode endpoint URLs.
    // Hardcoded URLs broke before when better-auth changed paths between versions.
    const { createAuthClient } = await import('better-auth/client')
    const { deviceAuthorizationClient } = await import('better-auth/client/plugins')
    const client = createAuthClient({
      baseURL: baseUrl,
      plugins: [deviceAuthorizationClient()],
    })

    if (ctx.daemon.isDaemon) {
      // ── DAEMON: poll until user approves in browser ──
      // Logs are visible to the parent when started with attach: true.
      const deviceCode = ctx.process.env.PENGUIN_BROWSER_DEVICE_CODE!
      const pollInterval = Number(ctx.process.env.PENGUIN_BROWSER_POLL_INTERVAL || 5) * 1000
      const expiresIn = Number(ctx.process.env.PENGUIN_BROWSER_DEVICE_EXPIRES_IN || 300)
      const deadline = Date.now() + expiresIn * 1000

      while (Date.now() < deadline) {
        await new Promise((r) => {
          setTimeout(r, pollInterval)
        })
        const { data: tokenData, error: pollError } = await client.device.token({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: 'penguin-browser-cli',
        })
        if (tokenData?.access_token) {
          saveCloudAuth({ token: tokenData.access_token, baseUrl })
          return // daemon exits, PID file is cleaned up
        }
        if (pollError?.error === 'authorization_pending' || pollError?.error === 'slow_down') continue
        if (pollError) {
          ctx.console.error(`Device authorization failed: ${pollError.error_description || pollError.error}`)
          ctx.process.exit(1)
          return
        }
      }
      ctx.console.error('Device authorization timed out.')
      ctx.process.exit(1)
      return
    }

    // ── FOREGROUND CLIENT ──
    ctx.console.log('Requesting device authorization...')
    const { data: deviceData, error: requestError } = await client.device.code({
      client_id: 'penguin-browser-cli',
    })
    if (requestError || !deviceData) {
      ctx.console.error(
        `Error: failed to request device code — ${requestError?.error_description || requestError?.error || 'unknown error'}`,
      )
      ctx.process.exit(1)
      return
    }

    const verificationUrl =
      deviceData.verification_uri_complete || `${baseUrl}/device?user_code=${deviceData.user_code}`
    ctx.console.log(`\nOpen this URL in your browser:\n  ${verificationUrl}\n`)
    ctx.console.log(`Code: ${deviceData.user_code}\n`)

    await openInBrowser(verificationUrl)

    const expiresIn = deviceData.expires_in || 300
    const daemonEnv = {
      PENGUIN_BROWSER_DEVICE_CODE: deviceData.device_code,
      PENGUIN_BROWSER_POLL_INTERVAL: String(deviceData.interval || 5),
      PENGUIN_BROWSER_DEVICE_EXPIRES_IN: String(expiresIn),
      PENGUIN_BROWSER_CLOUD_URL: baseUrl,
    }
    const timeoutMs = expiresIn * 1000

    if (isAgent) {
      // Agent: start daemon detached, return immediately
      await ctx.daemon.start({ timeoutMs, env: daemonEnv })
      ctx.console.log('Login running in background.')
      ctx.console.log('After approving in browser, verify with: penguin-browser cloud me')
      return
    }

    // Interactive: attach to daemon, see real-time logs and errors
    ctx.console.log('Waiting for approval...')
    await ctx.daemon.start({ attach: true, timeoutMs, env: daemonEnv })
    ctx.console.log(pc.green('\nLogged in successfully!'))
    ctx.console.log('Cloud browsers will now appear in `penguin-browser session new`.')
  })

cli.command('cloud me', 'Check cloud auth status (exits 1 if not logged in)').action(async (_options, ctx) => {
  const auth = loadCloudAuth()
  if (auth) {
    ctx.console.log('Authenticated')
    ctx.console.log(`Cloud URL: ${auth.baseUrl}`)
    return
  }

  // Check if login daemon is still running (user might not have approved yet)
  const loginDaemon = ctx.daemon.forCommand('cloud login')
  if (await loginDaemon.isRunning()) {
    ctx.console.error('Login in progress. Approve in browser first.')
    ctx.process.exit(1)
  }

  ctx.console.error('Not logged in. Run `penguin-browser cloud login` first.')
  ctx.process.exit(1)
})

cli.command('cloud logout', 'Clear cloud auth').action(async (_options, ctx) => {
  // Stop any running login daemon
  const loginDaemon = ctx.daemon.forCommand('cloud login')
  await loginDaemon.stop()

  // Remove the auth file
  try {
    const authFile = path.join(os.homedir(), '.penguin-browser', 'auth.json')
    fs.unlinkSync(authFile)
  } catch {
    // already gone
  }

  ctx.console.log('Logged out from cloud')
})

cli.command('cloud subscribe', 'Open the subscription page to purchase cloud browser sessions').action(async () => {
  const auth = loadCloudAuth()
  if (!auth) {
    console.error('Not logged in. Run `penguin-browser cloud login` first.')
    process.exit(1)
  }
  const subscribeUrl = new URL('/dashboard', auth.baseUrl).toString()
  console.log(`Open your browser to manage your subscription:\n  ${subscribeUrl}\n`)
  await openInBrowser(subscribeUrl)
})

cli.command('cloud status', 'Show active cloud browser sessions').action(async () => {
  const client = getCloudClient()
  if (!client) {
    console.error('Not logged in. Run `penguin-browser cloud login` first.')
    process.exit(1)
  }

  try {
    const { sessions } = await client.getStatus()

    if (sessions.length === 0) {
      console.log('No active cloud sessions.')
      console.log(pc.dim('Start one with: penguin-browser session new --browser cloud'))
      return
    }

    const keyWidth = Math.max(3, ...sessions.map((s) => `cloud-${s.index}`.length))
    console.log('KEY'.padEnd(keyWidth) + '  ' + 'STATUS'.padEnd(10) + '  ' + 'DETAILS')
    console.log('-'.repeat(keyWidth + 30))

    for (const s of sessions) {
      const key = `cloud-${s.index}`
      const timeoutAt = new Date(s.timeoutAt).toLocaleTimeString()
      console.log(key.padEnd(keyWidth) + '  ' + pc.green('running'.padEnd(10)) + '  ' + `expires ${timeoutAt}`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`Error: ${msg}`)
    process.exit(1)
  }
})

cli.command('cloud live [key]', 'Open a live browser view for an active cloud session').action(async (key) => {
  const client = getCloudClient()
  if (!client) {
    console.error('Not logged in. Run `penguin-browser cloud login` first.')
    process.exit(1)
  }

  try {
    const { sessions } = await client.getStatus()
    if (sessions.length === 0) {
      console.log('No active cloud sessions.')
      console.log(pc.dim('Start one with: penguin-browser session new --browser cloud'))
      process.exit(1)
    }

    let session: (typeof sessions)[number] | undefined
    if (key) {
      // Match by cloud-N key or by cloudSessionId
      session = sessions.find((s) => {
        return `cloud-${s.index}` === key || s.cloudSessionId === key || s.browserUseSessionId === key
      })
      if (!session) {
        console.error(`No active session matching "${key}".`)
        console.error(
          'Active sessions: ' +
            sessions
              .map((s) => {
                return `cloud-${s.index}`
              })
              .join(', '),
        )
        process.exit(1)
      }
    } else if (sessions.length === 1) {
      session = sessions[0]!
    } else {
      console.log('Multiple active sessions. Specify one:\n')
      for (const s of sessions) {
        console.log(`  cloud-${s.index}  (expires ${new Date(s.timeoutAt).toLocaleTimeString()})`)
      }
      console.log(`\nUsage: penguin-browser cloud live cloud-1`)
      process.exit(1)
    }

    if (!session.cdpUrl) {
      console.error('Session has no CDP URL — it may still be starting.')
      process.exit(1)
    }
    const auth = loadCloudAuth()!
    const liveUrl = buildLiveUrl(session.cdpUrl, auth.baseUrl)
    console.log(liveUrl)
    await openInBrowser(liveUrl)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`Error: ${msg}`)
    process.exit(1)
  }
})

cli.command('logfile', 'Print the path to the relay server log file').action(() => {
  console.log(`relay: ${LOG_FILE_PATH}`)
  console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
})

cli.command('skill', 'Print the full penguin-browser usage instructions').action(() => {
  const skillPath = path.join(packageRoot(), 'src', 'skill.md')
  const content = fs.readFileSync(skillPath, 'utf-8')
  console.log(content)
})

cli.help()
cli.completions()
cli.version(VERSION)

// Keep Goke's subcommand handling, while giving unknown top-level commands a
// useful recovery hint. Skip option values here: for example, the `1` in
// `-s 1 -e "..."` is a session ID, not a command name.
const optionFlagsWithValues = new Set([
  '--host',
  '--token',
  '-s',
  '--session',
  '-e',
  '--eval',
  '-f',
  '--file',
  '--timeout',
])
let firstPositionalArg: string | undefined
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!
  if (optionFlagsWithValues.has(arg)) {
    i++
    continue
  }
  if (arg.startsWith('-')) continue
  firstPositionalArg = arg
  break
}

if (firstPositionalArg) {
  const knownTopLevelCommands = new Set(cli.commands.map((command) => command.name.split(' ')[0]).filter(Boolean))
  if (!knownTopLevelCommands.has(firstPositionalArg)) {
    console.error(`Unknown command: ${process.argv.slice(2).join(' ')}\n`)
    console.error('Run `penguin-browser --help` to list available commands.')
    process.exit(1)
  }
}

await cli.parse()
