import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const BUNDLED_MCP_RESOURCES = [
  {
    name: 'debugger-api',
    uri: 'penguin-browser://resources/debugger-api.md',
    fileName: 'debugger-api.md',
  },
  {
    name: 'editor-api',
    uri: 'penguin-browser://resources/editor-api.md',
    fileName: 'editor-api.md',
  },
  {
    name: 'styles-api',
    uri: 'penguin-browser://resources/styles-api.md',
    fileName: 'styles-api.md',
  },
] as const

export function readBundledMcpResource(fileName: string): string {
  const packageJsonPath = require.resolve('penguin-browser/package.json')
  const packageDir = path.dirname(packageJsonPath)
  return fs.readFileSync(path.join(packageDir, 'dist', fileName), 'utf-8')
}
