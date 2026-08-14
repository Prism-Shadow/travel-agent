import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
  version: string
  private?: boolean
}
// Every manifest release bump must update this baseline in the same change. Exact
// equality makes a later rollback fail instead of leaving a permanently stale floor.
const EXPECTED_EXTENSION_RELEASE = '0.0.107'

const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8')) as {
  version: string
  manifest_version: number
}

describe('extension version policy', () => {
  it('keeps private package metadata aligned with the Chrome manifest release sequence', () => {
    expect(packageJson.private).toBe(true)
    expect(packageJson.version).toBe(manifest.version)
  })

  it('uses a valid monotonic Chrome manifest version shape', () => {
    expect(manifest.manifest_version).toBe(3)
    const components = manifest.version.split('.')
    expect(components.length).toBeGreaterThanOrEqual(1)
    expect(components.length).toBeLessThanOrEqual(4)
    for (const component of components) {
      expect(component).toMatch(/^(0|[1-9]\d*)$/)
      expect(Number(component)).toBeLessThanOrEqual(65535)
    }

    expect(manifest.version).toBe(EXPECTED_EXTENSION_RELEASE)
  })
})
