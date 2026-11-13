
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
  /** Send bytes, a string or a document with toBuffer() (PDF, workbook) as a download. */
  download(
    data: Uint8Array | ArrayBuffer | string | { toBuffer(): Promise<Uint8Array> },
    filename?: string,
    options?: { inline?: boolean; type?: string },
  ): Promise<TylixResponse>
}