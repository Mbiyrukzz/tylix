import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// packages/cli/src/utils -> packages/cli/package.json
let cached
export function getTylixVersion() {
  if (cached) return cached
  try {
    cached = require('../../package.json').version
  } catch {
    cached = 'unknown'
  }
  return cached
}