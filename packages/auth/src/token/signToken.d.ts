export interface TokenPayload {
  [key: string]: unknown
  exp?: number
}

export interface SignTokenOptions {
  expiresInSeconds?: number
}

export interface VerifyTokenResult {
  valid: boolean
  payload: TokenPayload | null
  error: string | null
}

export declare function signToken(
  payload: Record<string, unknown>,
  secret: string,
  options?: SignTokenOptions,
): string

export declare function verifyToken(token: string, secret: string): VerifyTokenResult