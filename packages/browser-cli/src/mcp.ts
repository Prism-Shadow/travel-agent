import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'

// Prevent Buffers from dumping hex bytes in util.inspect output.
// Without this, returning a screenshot Buffer would log ~400+ chars of useless hex.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import dedent from 'string-dedent'
import { LOG_FILE_PATH, VERSION, parseRelayHost } from './shared/utils.js'
import { distPath } from './shared/package-paths.js'
import { ensureRelayServer, RELAY_PORT } from './relay/relay-client.js'
import { PlaywrightExecutor, CodeExecutionTimeoutError } from './executor/executor.js'
import { discoverChromeInstances, resolveDirectInput, appendSessionToWsUrl } from './browser/chrome-discovery.js'
import crypto from 'node:crypto'
import { BUNDLED_MCP_RESOURCES, readBundledMcpResource } from './mcp/mcp-resources.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Single executor instance for MCP (created lazily)
let executor: PlaywrightExecutor | null = null

interface RemoteConfig {
  host: string
  port: number
  token?: string
}

function getRemoteConfig(): RemoteConfig | null {
  const host = process.env.PENGUIN_BROWSER_HOST
  if (!host) {
    return null
  }
  return {
    host,
    port: RELAY_PORT,
    token: process.env.PENGUIN_BROWSER_TOKEN,
  }
}

function getLogServerUrl(): string {
  const remote = getRemoteConfig()
  if (remote) {
    const { httpBaseUrl } = parseRelayHost(remote.host, remote.port)
    return `${httpBaseUrl}/mcp-log`
  }
  return `http://127.0.0.1:${RELAY_PORT}/mcp-log`
}

async function sendLogToRelayServer(level: string, ...args: any[]) {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = process.env.PENGUIN_BROWSER_TOKEN
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    await fetch(getLogServerUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ level, args }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // Silently fail if relay server is not available
  }
}

/**
 * Log to both console.error (for early startup) and relay server log file.
 * Fire-and-forget to avoid blocking.
 */
function mcpLog(...args: any[]) {
  console.error(...args)
  sendLogToRelayServer('log', ...args)
}

/** MCP-specific logger for executor */
const mcpLogger = {
  log: (...args: any[]) => mcpLog(...args),
  error: (...args: any[]) => {
    console.error(...args)
    sendLogToRelayServer('error', ...args)
  },
}

async function ensureRelayServerForMcp(): Promise<void> {
  await ensureRelayServer({ logger: mcpLogger })
}

/**
 * Resolve direct CDP config from PENGUIN_BROWSER_DIRECT env var.
 * - "auto" / "1" / "true": auto-discover Chrome on default port 9222
 * - "ws://..." / "wss://...": use explicit WebSocket endpoint
 * - "host:port": resolve to ws:// URL via HTTP probe + DevToolsActivePort fallback
 */
async function getDirectCdpConfig(): Promise<{ directCdpUrl: string } | null> {
  const directEnv = process.env.PENGUIN_BROWSER_DIRECT
  if (!directEnv) {
    return null
  }

  // Auto-discover: check default port 9222
  if (directEnv === '1') {
    const instances = await discoverChromeInstances()
    if (instances.length === 0) {
      throw new Error(
        'PENGUIN_BROWSER_DIRECT is set but no Chrome found on port 9222. ' +
          'Enable debugging at chrome://inspect/#remote-debugging or launch with --remote-debugging-port=9222.',
      )
    }
    const sessionId = crypto.randomUUID()
    const wsUrl = appendSessionToWsUrl(instances[0].wsUrl, sessionId)
    mcpLog(`Direct CDP: using ${instances[0].browser} on port ${instances[0].port}`)
    return { directCdpUrl: wsUrl }
  }

  // ws://, wss://, or host:port — resolveDirectInput handles all three
  const resolved = await resolveDirectInput(directEnv)
  const sessionId = crypto.randomUUID()
  const directCdpUrl = appendSessionToWsUrl(resolved, sessionId)
  mcpLog(`Direct CDP: resolved ${directEnv} → ${directCdpUrl}`)
  return { directCdpUrl }
}

async function getOrCreateExecutor(): Promise<PlaywrightExecutor> {
  if (executor) {
    return executor
  }

  // Direct CDP mode takes priority over relay/remote
  const directConfig = await getDirectCdpConfig()
  if (directConfig) {
    executor = new PlaywrightExecutor({
      cdpConfig: directConfig,
      logger: mcpLogger,
      cwd: process.cwd(),
    })
    return executor
  }

  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServerForMcp()
  }

  // Pass config instead of pre-generated URL so executor can generate unique URLs for each connection
  const cdpConfig = remote || { port: RELAY_PORT }
  executor = new PlaywrightExecutor({
    cdpConfig,
    logger: mcpLogger,
    cwd: process.cwd(),
  })

  return executor
}

async function checkRemoteServer({ host, port, token }: RemoteConfig): Promise<void> {
  const { httpBaseUrl } = parseRelayHost(host, port)
  const versionUrl = `${httpBaseUrl}/version`
  try {
    const response = await fetch(versionUrl, {
      signal: AbortSignal.timeout(3000),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }
  } catch (error: any) {
    const isConnectionError = error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError'
    if (isConnectionError) {
      throw new Error(
        `Cannot connect to remote relay server at ${host}. ` +
          `Make sure 'npx -y penguin-browser serve' is running on the host machine.`,
      )
    }
    throw new Error(`Failed to connect to remote relay server: ${error.message}`)
  }
}

const server = new McpServer({
  name: 'penguin-browser',
  title: 'The better playwright MCP: works as a browser extension. No context bloat. More capable.',
  version: VERSION,
})

const promptContent =
  fs.readFileSync(distPath('prompt.md'), 'utf-8') +
  `\n\nfor debugging internal penguin-browser errors, check penguin-browser relay server logs at: ${LOG_FILE_PATH}`

for (const resource of BUNDLED_MCP_RESOURCES) {
  server.resource(resource.name, resource.uri, { mimeType: 'text/plain' }, async () => {
    return {
      contents: [
        {
          uri: resource.uri,
          text: readBundledMcpResource(resource.fileName),
          mimeType: 'text/plain',
        },
      ],
    }
  })
}

const DEFAULT_EXEC_TIMEOUT = Number(process.env.PENGUIN_BROWSER_EXEC_TIMEOUT) || 10000

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z
      .number()
      .default(DEFAULT_EXEC_TIMEOUT)
      .describe('Timeout in milliseconds for code execution (default: 10000ms, or PENGUIN_BROWSER_EXEC_TIMEOUT)'),
  },
  async ({ code, timeout }) => {
    try {
      // Check relay server on every execute to auto-recover from crashes
      // (skip in direct CDP mode — no relay involved)
      if (!process.env.PENGUIN_BROWSER_DIRECT) {
        const remote = getRemoteConfig()
        if (!remote) {
          await ensureRelayServerForMcp()
        }
      }

      const exec = await getOrCreateExecutor()
      const result = await exec.execute(code, timeout)

      // Transform executor result to MCP format
      // Append screenshot metadata to text for MCP (image is included inline as content)
      const MAX_TEXT = 10000
      let text = result.text
      for (const s of result.screenshots) {
        text += `\nScreenshot saved to: ${s.path} (image included below, ${s.labelCount} labels)\n`
        text += `Accessibility snapshot:\n${s.snapshot}\n`
      }
      if (text.length > MAX_TEXT) {
        text = text.slice(0, MAX_TEXT) + '\n\n[Truncated]'
      }

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text },
      ]

      for (const image of result.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }

      if (result.isError) {
        return { content, isError: true }
      }

      return { content }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError =
        error instanceof CodeExecutionTimeoutError || error?.name === 'TimeoutError' || error?.name === 'AbortError'

      console.error('Error in execute tool:', errorStack)
      if (!isTimeoutError) {
        sendLogToRelayServer('error', 'Error in execute tool:', errorStack)
      }

      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'

      // timeout stacks are internal noise (Promise.race / setTimeout); only show the message
      const errorText = isTimeoutError ? error.message : errorStack
      return {
        content: [{ type: 'text', text: `Error executing code: ${errorText}${resetHint}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, if there are no pages in context, assertion failures, page closed, or other issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    This tools also removes any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.

    if playwright always returns all pages as about:blank urls and evaluate does not work you should ask the user to restart Chrome. This is a known Chrome bug.
  `,
  {},
  async () => {
    try {
      // Check relay server to auto-recover from crashes
      // (skip in direct CDP mode — no relay involved)
      if (!process.env.PENGUIN_BROWSER_DIRECT) {
        const remote = getRemoteConfig()
        if (!remote) {
          await ensureRelayServerForMcp()
        }
      }

      const exec = await getOrCreateExecutor()
      const { page, context } = await exec.reset()
      const pagesCount = context.pages().length
      return {
        content: [
          {
            type: 'text',
            text: `Connection reset successfully. ${pagesCount} page(s) available. Current page URL: ${page.url()}`,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to reset connection: ${error.message}` }],
        isError: true,
      }
    }
  },
)

export async function startMcp(options: { host?: string; token?: string } = {}) {
  if (options.host) {
    process.env.PENGUIN_BROWSER_HOST = options.host
  }
  if (options.token) {
    process.env.PENGUIN_BROWSER_TOKEN = options.token
  }

  // In direct CDP mode (PENGUIN_BROWSER_DIRECT env var), no relay server needed
  if (process.env.PENGUIN_BROWSER_DIRECT) {
    mcpLog(`Using direct CDP connection: ${process.env.PENGUIN_BROWSER_DIRECT}`)
  } else {
    const remote = getRemoteConfig()
    if (!remote) {
      await ensureRelayServerForMcp()
    } else {
      mcpLog(`Using remote CDP relay server: ${remote.host}`)
      await checkRemoteServer(remote)
    }
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
