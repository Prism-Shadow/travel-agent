import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * This package's own root, found by walking up until a `package.json` appears.
 *
 * Deliberately not `path.join(__dirname, '..')`. That form hard-codes how deep the asking file
 * sits, and it read as correct for years only because every source file was directly under `src/`
 * (and every build output directly under `dist/`), where `..` happened to mean the package root
 * from both. Grouping the sources into `src/relay`, `src/page`, ... moved them one level down and
 * every such path silently became `src/dist/...` — a runtime failure that no type checker can see.
 *
 * Walking up gives the same answer from `src/`, `src/page/`, `dist/`, `dist/page/`, or from inside
 * `node_modules`, which is what "where is my package" actually means.
 */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    // Reached the filesystem root without finding one: fall back to asking the resolver, which is
    // the case where this file was bundled somewhere with no package.json above it.
    if (parent === dir) return path.dirname(require.resolve('penguin-browser/package.json'))
    dir = parent
  }
}

/** A build output: the injected client bundles, the generated markdown the MCP serves. */
export function distPath(...segments: string[]): string {
  return path.join(packageRoot(), 'dist', ...segments)
}

export function getInstalledPenguinBrowserPackageDir(): string {
  return packageRoot()
}

export function getBundledExtensionPath(): string {
  const packageDir = getInstalledPenguinBrowserPackageDir()
  const candidates = [
    path.join(packageDir, 'dist', 'extension'),
    path.join(packageDir, '..', 'extension', 'dist'),
  ]

  for (const extensionPath of candidates) {
    const manifestPath = path.join(extensionPath, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      return extensionPath
    }
  }

  throw new Error(
    `Bundled Penguin Browser extension not found under ${packageDir}. Rebuild or reinstall the penguin-browser package.`,
  )
}
