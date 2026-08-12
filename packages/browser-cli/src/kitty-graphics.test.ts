import { describe, expect, test } from 'vitest'
import { buildKittySequence, canEmitKittyGraphics } from './kitty-graphics.js'

// Minimal valid PNG (1x1 transparent pixel) as base64
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('kitty-graphics', () => {
  describe('canEmitKittyGraphics', () => {
    test('returns false when AGENT_GRAPHICS is not set', () => {
      const prev = process.env.AGENT_GRAPHICS
      delete process.env.AGENT_GRAPHICS
      expect(canEmitKittyGraphics()).toBe(false)
      if (prev !== undefined) {
        process.env.AGENT_GRAPHICS = prev
      }
    })

    test('returns true when AGENT_GRAPHICS=kitty', () => {
      const prev = process.env.AGENT_GRAPHICS
      process.env.AGENT_GRAPHICS = 'kitty'
      expect(canEmitKittyGraphics()).toBe(true)
      if (prev !== undefined) {
        process.env.AGENT_GRAPHICS = prev
      } else {
        delete process.env.AGENT_GRAPHICS
      }
    })

    test('returns true when AGENT_GRAPHICS contains kitty among others', () => {
      const prev = process.env.AGENT_GRAPHICS
      process.env.AGENT_GRAPHICS = 'kitty,iterm2'
      expect(canEmitKittyGraphics()).toBe(true)
      if (prev !== undefined) {
        process.env.AGENT_GRAPHICS = prev
      } else {
        delete process.env.AGENT_GRAPHICS
      }
    })
  })

  describe('buildKittySequence', () => {
    test('small payload produces single escape sequence', () => {
      const result = buildKittySequence({ base64: 'AAAA' })
      expect(result).toMatchInlineSnapshot(`"_Ga=T,f=100;AAAA\\"`)
    })

    test('sequence starts with APC and ends with ST', () => {
      const result = buildKittySequence({ base64: 'AAAA' })
      expect(result.startsWith('\x1b_G')).toBe(true)
      expect(result.endsWith('\x1b\\')).toBe(true)
    })

    test('real PNG base64 produces valid sequence', () => {
      const result = buildKittySequence({ base64: TINY_PNG_B64 })
      // Should be a single chunk (small payload)
      expect(result).toContain('a=T,f=100')
      expect(result).toContain(TINY_PNG_B64)
    })

    test('large payload is chunked at 4096 bytes', () => {
      // Create a payload larger than 4096 bytes
      const bigPayload = 'A'.repeat(10000)
      const result = buildKittySequence({ base64: bigPayload })

      // Should have multiple escape sequences
      // First chunk: a=T,f=100,m=1
      expect(result).toContain('a=T,f=100,m=1')
      // Last chunk: m=0
      expect(result).toContain('\x1b_Gm=0;')
      // Should NOT contain single-shot a=T,f=100; (without m=)
      expect(result).not.toMatch(/a=T,f=100;/)
    })

    test('three-chunk payload has correct structure', () => {
      // 9000 bytes = 3 chunks: 4096 + 4096 + 808
      const payload = 'B'.repeat(9000)
      const result = buildKittySequence({ base64: payload })

      const sequences = result.split('\x1b\\').filter(Boolean)
      expect(sequences.length).toBe(3)

      // First: a=T,f=100,m=1
      expect(sequences[0]).toContain('a=T,f=100,m=1')
      // Middle: m=1
      expect(sequences[1]).toContain('\x1b_Gm=1;')
      // Last: m=0
      expect(sequences[2]).toContain('\x1b_Gm=0;')
    })
  })

  describe('round-trip with kitty-graphics-agent parser', () => {
    test('emitted sequence can be parsed back to extract the image', async () => {
      // Dynamically import the parser to test round-trip
      let extractKittyGraphics: typeof import('kitty-graphics-agent/parser').extractKittyGraphics
      try {
        const mod = await import('kitty-graphics-agent/parser')
        extractKittyGraphics = mod.extractKittyGraphics
      } catch {
        // kitty-graphics-agent not installed, skip
        console.log('kitty-graphics-agent not installed, skipping round-trip test')
        return
      }

      const sequence = buildKittySequence({ base64: TINY_PNG_B64 })
      const output = `some text before\n${sequence}\nsome text after`
      const result = extractKittyGraphics(output)

      expect(result.cleanedOutput).toMatchInlineSnapshot(`
        "some text before
        
        some text after"
      `)
      expect(result.images.length).toBe(1)
      expect(result.images[0].mime).toBe('image/png')
      expect(result.images[0].data).toBe(TINY_PNG_B64)
    })

    test('chunked sequence round-trips correctly', async () => {
      let extractKittyGraphics: typeof import('kitty-graphics-agent/parser').extractKittyGraphics
      try {
        const mod = await import('kitty-graphics-agent/parser')
        extractKittyGraphics = mod.extractKittyGraphics
      } catch {
        console.log('kitty-graphics-agent not installed, skipping round-trip test')
        return
      }

      const bigPayload = 'A'.repeat(10000)
      const sequence = buildKittySequence({ base64: bigPayload })
      const result = extractKittyGraphics(sequence)

      expect(result.cleanedOutput).toBe('')
      expect(result.images.length).toBe(1)
      expect(result.images[0].mime).toBe('image/png')
      expect(result.images[0].data).toBe(bigPayload)
    })
  })
})
