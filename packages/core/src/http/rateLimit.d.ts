export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export declare function createRateLimiter(options: {
  max: number
  windowMs: number
}): (key: string) => RateLimitResult