import type { Store } from '../store/index.js'

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

/** Counts in this process; answers synchronously. */
export declare function createRateLimiter(options: { max: number; windowMs: number }): (key: string) => RateLimitResult
/** Counts in the app's store ('shared') or the given store, across every process; answers with a Promise. */
export declare function createRateLimiter(options: {
  max: number
  windowMs: number
  store: 'shared' | Store
  /** Names the counter, so every process counts under the same key. */
  name: string
}): (key: string) => Promise<RateLimitResult>
