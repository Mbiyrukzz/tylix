// zlib (RFC 1950) compression through the platform's CompressionStream,
// available in Node 18+, Deno, Bun and all current browsers. No
// dependencies and no node: imports, so the package runs anywhere.

import { concat } from './bytes.js'

const supported = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter()
  writer.write(bytes)
  writer.close()
  const chunks = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return concat(chunks)
}

export function canCompress() {
  return supported
}

export async function deflate(bytes) {
  return pipe(bytes, new CompressionStream('deflate'))
}

export async function inflate(bytes) {
  if (!supported) throw new Error('This runtime has no DecompressionStream, which PNG images need.')
  return pipe(bytes, new DecompressionStream('deflate'))
}
