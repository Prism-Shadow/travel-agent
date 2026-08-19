import { describe, expect, it } from 'vitest'
import { BUNDLED_MCP_RESOURCES, readBundledMcpResource } from '../src/mcp/mcp-resources.js'

describe('bundled MCP resources', () => {
  it('uses self-contained URIs and readable bundled documents', () => {
    expect(BUNDLED_MCP_RESOURCES.map((resource) => resource.uri)).toEqual([
      'penguin-browser://resources/debugger-api.md',
      'penguin-browser://resources/editor-api.md',
      'penguin-browser://resources/styles-api.md',
    ])

    for (const resource of BUNDLED_MCP_RESOURCES) {
      expect(readBundledMcpResource(resource.fileName).length).toBeGreaterThan(500)
    }
  })
})
