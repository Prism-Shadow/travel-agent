import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXTENSION_IDS } from '../src/shared/utils.js'

function extensionIdFromManifestKey(key: string): string {
  const publicKeyDer = Buffer.from(key, 'base64')
  const digest = crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32)
  return digest.replace(/[0-9a-f]/g, (digit) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(digit, 16)))
}

describe('Penguin Browser extension identity', () => {
  it('keeps the manifest-derived extension ID in the relay allowlist', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const manifestPath = path.resolve(currentDir, '../../browser-extension/manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { key?: string }

    expect(manifest.key, 'extension/manifest.json must contain a stable public key').toBeTruthy()
    expect(EXTENSION_IDS).toContain(extensionIdFromManifestKey(manifest.key!))
  })
})
