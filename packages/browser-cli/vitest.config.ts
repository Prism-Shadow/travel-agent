import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000, // 60 seconds for Chrome startup
    // Setup, not a test: a browser-backed suite builds the extension, launches Chromium and waits
    // for its service worker. The build is serialized across worker processes (see
    // `withExtensionBuildLock`), so a suite's setup legitimately spends time queued behind another
    // suite's build — and a 30-second budget turned that queue into a suite-level failure whose
    // tests were then reported as *skipped*, which reads exactly like a missing-browser baseline.
    // Eight of the ten browser suites already set 600000 themselves; this is the same number in one
    // place.
    hookTimeout: 600000,
    // Every browser-backed file launches its own Chromium, extension and relay. Left to the
    // default worker count, a dozen of them start together and contend for the CPU until an MCP
    // request misses its 60 s budget (GitHub #8, "MCP error -32001"). Four at a time keeps the
    // suite parallel without turning wall-clock into a test input; CI runners have four vCPUs,
    // so two there.
    maxWorkers: process.env.CI ? 2 : 4,
    exclude: ['dist', 'dist/**/*', 'node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],

    env: {
      PENGUIN_BROWSER_NODE_ENV: 'development',
    },
  },
})
