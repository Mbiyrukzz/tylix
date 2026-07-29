export interface LoginAllowedResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export declare function checkLoginAllowed(identifier: string): LoginAllowedResult
export declare function recordFailedLogin(identifier: string): { count: number; firstAttemptAt: number; lockedUntil: number | null }
export declare function clearLoginAttempts(identifier: string): void