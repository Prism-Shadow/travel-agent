import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const penguinBrowserDir = path.join(__dirname, '..')
const packagesDir = path.join(penguinBrowserDir, '..')
// 上游布局里 penguin-browser/ 与 extension/ 是仓库根的同级目录；并入 travel-agent 后
// 变成 packages/browser-cli 与 packages/browser-extension。见 VENDOR.md。
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

async function main(): Promise<void> {
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
