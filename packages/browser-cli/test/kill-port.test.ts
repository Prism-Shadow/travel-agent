// Test that killPortProcess can terminate a real subprocess bound to a TCP port.

import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { getListeningPidsForPort, killPortProcess } from '../src/kill-port.js'

async function getFreeTcpPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.on('error', (error) => {
      reject(error)
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to get ephemeral port'))
        })
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function waitForListeningPidCount({
  port,
  predicate,
  timeoutMs,
}: {
  port: number
  predicate: (pids: number[]) => boolean
  timeoutMs: number
}): Promise<number[]> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    const pids = await getListeningPidsForPort({ port }).catch(() => [])
    if (predicate(pids)) {
      return pids
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50)
    })
  }

  const pids = await getListeningPidsForPort({ port }).catch(() => [])
  throw new Error(`Timed out waiting for port ${port} pid condition (pids: ${pids.join(', ') || 'none'})`)
}

describe('killPortProcess', () => {
  it('kills a real http server subprocess and reports timing', async () => {
    const port = await getFreeTcpPort()

    const child = spawn(
      process.execPath,
      [
        '-e',
        [
          "const http = require('http');",
          'const port = Number(process.env.TEST_PORT);',
          "const host = '127.0.0.1';",
          "const server = http.createServer((req, res) => { res.statusCode = 200; res.end('ok'); });",
          'server.listen(port, host, () => { console.log(`listening:${port}`); });',
          // Keep the process alive.
          'setInterval(() => {}, 1000);',
        ].join(' '),
      ],
      {
        env: { ...process.env, TEST_PORT: String(port) },
        stdio: 'ignore',
      },
    )

    try {
      await waitForListeningPidCount({
        port,
        predicate: (pids) => pids.length > 0,
        timeoutMs: 5000,
      })

      const start = Date.now()
      await killPortProcess({ port })

      await waitForListeningPidCount({
        port,
        predicate: (pids) => pids.length === 0,
        timeoutMs: 5000,
      })

      const elapsedMs = Date.now() - start
      console.log(`[kill-port] port ${port} killed in ${elapsedMs}ms`) // for perf visibility in CI logs

      const maxMs = process.platform === 'win32' ? 15000 : 5000
      expect(elapsedMs).toBeLessThan(maxMs)
    } finally {
      // Best-effort cleanup if the kill failed for any reason.
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  })
})
