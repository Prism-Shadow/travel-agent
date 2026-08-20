import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const penguinBrowserDir = path.join(__dirname, '..')
const packagesDir = path.join(penguinBrowserDir, '..')
// Upstream kept penguin-browser/ and extension/ as siblings of the repository root; merged
// into travel-agent they are packages/browser-cli and packages/browser-extension.
const extensionDir = path.join(packagesDir, 'browser-extension')
const extensionOutDirName = 'dist-packaged'
const extensionOutDir = path.join(extensionDir, extensionOutDirName)
const bundledExtensionDir = path.join(penguinBrowserDir, 'dist', 'extension')

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
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
    })

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
 * Fails early when the extension's deep imports into browser-cli cannot resolve.
 *
 * The workspace materializes browser-cli into a hard-linked copy rather than a symlink
 * (`injectWorkspacePackages`), and that copy re-syncs only after a **successful** build.
 * Editing a file propagates through the shared inode; adding, moving or deleting one does not.
 * Because this extension build is a step *inside* browser-cli's build, a layout change
 * deadlocks: the bundler resolves `penguin-browser/src/…` against the stale copy and fails, so
 * the sync that would repair the copy never runs, and every retry fails identically
 * (docs/issues/0005).
 *
 * Checking the imports before the bundler does turns that deadlock into one instruction.
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
    return !['', '.ts', '.tsx', '.js', '.mjs'].some((ext) => fs.existsSync(base + ext))
  })
  if (missing.length === 0) return

  throw new Error(
    [
      'The injected copy of penguin-browser is stale: the extension imports paths that do not',
      'exist in it. This happens after browser-cli files are added, moved, renamed or deleted,',
      'because the copy is hard-linked and only re-syncs after a successful build — which this',
      'build cannot be until the copy is repaired (docs/issues/0005).',
      '',
      'Missing in the copy:',
      ...missing.map((specifier) => `  penguin-browser/${specifier}`),
      '',
      'Repair it from the repository root, then build again:',
      '  rm -f node_modules/.pnpm-workspace-state-v1.json && pnpm install',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  assertInjectedCopyIsCurrent()

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

  await runCommand({
    command: pnpmCommand,
    args: ['build'],
    cwd: extensionDir,
    env: {
      ...process.env,
      PENGUIN_BROWSER_EXTENSION_DIST: extensionOutDirName,
      PENGUIN_BROWSER_OPEN_WELCOME_PAGE: '0',
    },
  })

  fs.rmSync(bundledExtensionDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(bundledExtensionDir), { recursive: true })
  fs.cpSync(extensionOutDir, bundledExtensionDir, { recursive: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
