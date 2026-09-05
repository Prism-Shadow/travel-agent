import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

/**
 * Builds the packaged extension variant into `dist-packaged/`.
 *
 * Two variants exist on purpose. `dist/` is the copy a user loads unpacked into their own
 * Chrome (it opens the welcome page on install); `dist-packaged/` is the copy the
 * `penguin-browser browser` command auto-loads into the Chrome it launches, where a welcome
 * tab would be noise — `PENGUIN_BROWSER_OPEN_WELCOME_PAGE=0` is baked in at bundle time.
 *
 * This build used to be a step nested *inside* browser-cli's build, which deadlocked the
 * workspace after a browser-cli layout change: this package resolves `penguin-browser/src/…`
 * against the injected hard-linked copy, that copy re-syncs only after a **successful**
 * browser-cli build, and the nested extension build made that build fail against the stale
 * copy — the sync was gated on a build that could not succeed until the sync ran. Building
 * the variant here, in this package's own build, puts the sync between the two builds in
 * `pnpm -r` topological order and dissolves the deadlock.
 *
 * The preflight keeps the one residual trap legible: building this package alone, after a
 * browser-cli layout change, without rebuilding browser-cli first.
 *
 * Skipped when the caller pins PENGUIN_BROWSER_EXTENSION_DIST: that is a test build driving
 * one custom output directory (see browser-cli's test-utils), never a release build.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extensionDir = path.join(__dirname, '..')
const outDirName = 'dist-packaged'
const outDir = path.join(extensionDir, outDirName)

function runCommand({
  command,
  args,
  cwd,
  env,
}: {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
    })
  })
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Fails early when this package's deep imports into browser-cli cannot resolve.
 *
 * The workspace materializes browser-cli into a hard-linked copy rather than a symlink
 * (`injectWorkspacePackages`). Editing a file propagates through the shared inode; adding,
 * moving or deleting one does not — only a successful browser-cli build re-syncs the copy.
 * A full `pnpm -r build` therefore never hits this; building this package alone after a
 * browser-cli layout change can. Checking the imports before the bundler does turns the
 * confusing bundler error into one instruction.
 */
function assertInjectedCopyIsCurrent(): void {
  const injectedRoot = path.join(extensionDir, 'node_modules', 'penguin-browser')
  if (!fs.existsSync(injectedRoot)) return // Not an injected install — let the bundler speak.

  const specifiers = new Set<string>()
  for (const file of collectSourceFiles(path.join(extensionDir, 'src'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/penguin-browser\/(src\/[\w./-]+)/g)) specifiers.add(match[1])
  }

  const missing = [...specifiers].filter((specifier) => {
    const base = path.join(injectedRoot, specifier)
    const candidates = ['', '.ts', '.tsx', '.js', '.mjs'].map((ext) => base + ext)
    // An ESM-style specifier names compiled output (`.js`) while the copy carries sources:
    // accept the TypeScript sources behind a `.js` suffix, the way the bundler resolves them.
    if (specifier.endsWith('.js')) {
      const stem = base.slice(0, -'.js'.length)
      candidates.push(stem + '.ts', stem + '.tsx')
    }
    return !candidates.some((candidate) => fs.existsSync(candidate))
  })
  if (missing.length === 0) return

  throw new Error(
    [
      'The injected copy of penguin-browser is stale: this extension imports paths that do not',
      'exist in it. This happens after browser-cli files are added, moved, renamed or deleted,',
      'because the copy is hard-linked and only re-syncs after a successful browser-cli build.',
      '',
      'Missing in the copy:',
      ...missing.map((specifier) => `  penguin-browser/${specifier}`),
      '',
      'Repair it by rebuilding browser-cli (its build re-syncs the copy), then build again:',
      '  pnpm --filter penguin-browser build',
      'If the copy is still stale after that, re-materialize it from the repository root:',
      '  rm -f node_modules/.pnpm-workspace-state-v1.json && pnpm install',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  if (process.env.PENGUIN_BROWSER_EXTENSION_DIST) {
    console.log(
      `[build-packaged] skipped: PENGUIN_BROWSER_EXTENSION_DIST=${process.env.PENGUIN_BROWSER_EXTENSION_DIST} pins a single custom output`,
    )
    return
  }

  assertInjectedCopyIsCurrent()

  // vite builds with emptyOutDir: false (the static-copy plugin owns part of the tree), so
  // clear the variant directory here to keep the artifact self-contained.
  fs.rmSync(outDir, { recursive: true, force: true })

  // Run vite's own entry under this Node rather than `pnpm exec vite`: on Windows that resolves
  // to pnpm.cmd, which Node refuses to spawn without a shell (the CVE-2024-27980 hardening,
  // `spawn EINVAL`), and a shell would mean quoting arguments for two command languages.
  const vitePackage = createRequire(path.join(extensionDir, 'package.json')).resolve('vite/package.json')
  const viteBin = path.join(path.dirname(vitePackage), 'bin', 'vite.js')
  await runCommand({
    command: process.execPath,
    args: [viteBin, 'build', '--config', 'vite.config.mts'],
    cwd: extensionDir,
    env: {
      ...process.env,
      PENGUIN_BROWSER_EXTENSION_DIST: outDirName,
      PENGUIN_BROWSER_OPEN_WELCOME_PAGE: '0',
    },
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
