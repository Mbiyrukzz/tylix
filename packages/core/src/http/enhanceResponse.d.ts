export interface CookieOptions {
  maxAge?: number
  expires?: Date
  path?: string
  domain?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
}

export declare function enhanceResponse<T extends import('node:http').ServerResponse>(
  res: T,
): T & {
  status(code: number): T
  json(data: unknown): T
  send(data?: unknown): T
  cookie(name: string, value: string, options?: CookieOptions): T
  clearCookie(name: string, options?: CookieOptions): T
  /** Send bytes, a string or a document with toBuffer() (PDF, workbook) as a download. */
  download(
    data: Uint8Array | ArrayBuffer | string | { toBuffer(): Promise<Uint8Array> },
    filename?: string,
    options?: { inline?: boolean; type?: string },
  ): Promise<T>
}