// Copies vendored Prism.js assets into <outDir>/src/ for the welcome page.
// Chrome extension CSP blocks external scripts, so builds must remain local and reproducible.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const vendorDir = path.resolve(scriptDir, '../vendor/prism')
const outDir = process.env.PENGUIN_BROWSER_EXTENSION_DIST || 'dist'
const destinationDir = path.join(outDir, 'src')
const files = ['prism.min.js', 'prism-bash.min.js']

fs.mkdirSync(destinationDir, { recursive: true })
for (const file of files) {
  const source = path.join(vendorDir, file)
  if (!fs.existsSync(source)) {
    throw new Error(`Missing vendored Prism.js asset: ${source}`)
  }
  fs.copyFileSync(source, path.join(destinationDir, file))
}

console.log(`Copied ${files.length} vendored Prism.js files to ${destinationDir}`)
