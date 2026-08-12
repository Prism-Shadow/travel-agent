// Kitty Graphics Protocol emitter for CLI output.
// Emits base64-encoded PNG images as APC escape sequences so agents with
// kitty-graphics-agent (or compatible parsers) can extract and pass them
// to LLMs as media parts.
//
// Protocol format:
//   \x1b_G<control_data>;<base64_payload>\x1b\\
//
// Only emits when AGENT_GRAPHICS env var contains 'kitty', signaling that
// an agent is intercepting stdout and can handle Kitty Graphics Protocol.
// See: https://github.com/remorses/kitty-graphics-agent

// Kitty spec recommends max 4096 bytes per chunk payload
const CHUNK_SIZE = 4096

/**
 * Check if the current environment supports Kitty Graphics Protocol output.
 * Returns true when AGENT_GRAPHICS=kitty is set (agent is intercepting stdout).
 */
export function canEmitKittyGraphics(): boolean {
  return process.env.AGENT_GRAPHICS?.includes('kitty') ?? false
}

/**
 * Emit a PNG image to stdout using the Kitty Graphics Protocol.
 * The image is chunked per the spec (4096 bytes per chunk).
 *
 * Only call this when canEmitKittyGraphics() returns true.
 */
export function emitKittyImage({ base64 }: { base64: string }): void {
  const chunks = splitIntoChunks(base64, CHUNK_SIZE)

  if (chunks.length === 1) {
    // Single chunk: no chunked transfer needed
    process.stdout.write(`\x1b_Ga=T,f=100;${chunks[0]}\x1b\\`)
    return
  }

  // Multi-chunk: first chunk has full control data + m=1,
  // continuation chunks have only m=1, last chunk has m=0
  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0
    const isLast = i === chunks.length - 1
    const control = isFirst ? 'a=T,f=100,m=1' : isLast ? 'm=0' : 'm=1'
    process.stdout.write(`\x1b_G${control};${chunks[i]}\x1b\\`)
  }
}

function splitIntoChunks(str: string, size: number): string[] {
  if (str.length <= size) {
    return [str]
  }
  const chunks: string[] = []
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size))
  }
  return chunks
}

/**
 * Build the raw Kitty Graphics escape sequence string for a PNG image.
 * Useful for testing without writing to stdout.
 */
export function buildKittySequence({ base64 }: { base64: string }): string {
  const chunks = splitIntoChunks(base64, CHUNK_SIZE)

  if (chunks.length === 1) {
    return `\x1b_Ga=T,f=100;${chunks[0]}\x1b\\`
  }

  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0
    const isLast = i === chunks.length - 1
    const control = isFirst ? 'a=T,f=100,m=1' : isLast ? 'm=0' : 'm=1'
    parts.push(`\x1b_G${control};${chunks[i]}\x1b\\`)
  }
  return parts.join('')
}
