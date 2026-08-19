// Verifies CLI help stays runnable without loading browser-start-only dependencies.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const penguinBrowserDir = path.resolve(currentDir, '..')
const viteNodeBinary = path.join(
  penguinBrowserDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(viteNodeBinary, ['src/cli.ts', ...args], {
    cwd: penguinBrowserDir,
    env: process.env,
  })
}

describe('penguin-browser cli help', () => {
  test('renders root help without crashing', async () => {
    const { stdout, stderr } = await runCli(['--help'])

    expect(stdout).toContain('penguin-browser')
    expect(stdout).toContain('serve')
    expect(stderr).toBe('')
  }, 30000)

  test('renders serve help without crashing', async () => {
    const { stdout, stderr } = await runCli(['serve', '--help'])

    expect(stdout).toContain('Start the relay server on this machine')
    expect(stdout).toContain('--replace')
    expect(stderr).toBe('')
  }, 30000)

  test('renders cloud login help without a dead hosted-service URL', async () => {
    const { stdout, stderr } = await runCli(['cloud', 'login', '--help'])

    expect(stdout).toContain('configured private Penguin Browser cloud deployment')
    expect(stdout).toContain('PENGUIN_BROWSER_CLOUD_URL')
    expect(stdout).not.toContain('private-project.invalid')
    expect(stderr).toBe('')
  }, 30000)

  test('refuses cloud login until a deployment URL is configured', async () => {
    const previousCloudUrl = process.env.PENGUIN_BROWSER_CLOUD_URL
    delete process.env.PENGUIN_BROWSER_CLOUD_URL
    try {
      await expect(runCli(['cloud', 'login'])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('Cloud login is not configured in this local-development build.'),
      })
    } finally {
      if (previousCloudUrl === undefined) delete process.env.PENGUIN_BROWSER_CLOUD_URL
      else process.env.PENGUIN_BROWSER_CLOUD_URL = previousCloudUrl
    }
  }, 30000)

  test('unknown command exits with code 1', async () => {
    try {
      await runCli(['run'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stderr).toContain('Unknown command: run')
      expect(error.stderr).toContain('penguin-browser --help')
    }
  }, 30000)

  test('unknown subcommand exits with code 1', async () => {
    try {
      await runCli(['session', 'nonexistent'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stdout).toContain('Unknown command: session nonexistent')
      expect(error.stdout).toContain('session new')
    }
  }, 30000)
})
