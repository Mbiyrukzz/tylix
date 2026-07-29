
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CookieOptions } from './enhanceResponse.js'

export interface TylixRequest extends IncomingMessage {
  params: Record<string, string>
  query: Record<string, string>
  cookies: Record<string, string>
  body: Record<string, unknown>
  user?: Record<string, unknown>
}

export interface TylixResponse extends ServerResponse {
  status(code: number): TylixResponse
  json(data: unknown): TylixResponse
  send(data?: unknown): TylixResponse
  cookie(name: string, value: string, options?: CookieOptions): TylixResponse
  clearCookie(name: string, options?: CookieOptions): TylixResponse
}