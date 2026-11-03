import type { IncomingMessage } from 'node:http'

export interface ReadBodyOptions {
  /** Maximum body size in bytes. Defaults to 1 MB. Larger bodies reject with status 413. */
  maxBytes?: number
}

/**
 * Reads the whole request body once. `raw` is the exact UTF-8 text the
 * client sent (use it for webhook signatures). `body` is the parsed JSON,
 * or {} for empty and non-JSON bodies. Rejects with an Error carrying
 * `status` (413 too large, 400 invalid JSON).
 */
export declare function readBody(
  req: IncomingMessage,
  options?: ReadBodyOptions,
): Promise<{ raw: string; body: any }>

export declare function parseBody(
  req: IncomingMessage,
  options?: ReadBodyOptions,
): Promise<any>