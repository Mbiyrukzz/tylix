// Present on failed requests only when the server runs with APP_DEBUG=true.
interface TylixDebugInfo {
  status: number
  name: string
  message: string
  title: string | null
  hint: string | null
  kind: string | null
  driver: 'mysql' | 'postgres' | 'sqlite' | 'mongodb' | null
  code: string | number | null
  detail: string | null
  table: string | null
  column: string | null
  sql: string | null
  params: unknown[]
  frames: Array<{
    fn: string | null
    file: string
    short: string
    line: number
    column: number
    kind: 'app' | 'vendor' | 'internal'
  }>
  source: {
    file: string
    line: number
    column: number
    start: number
    lines: string[]
  } | null
  request: { method: string; url: string }
}

interface TylixApiResult {
  ok: boolean
  status: number
  data: any
  error?: string | null
  debug?: TylixDebugInfo | null
}

interface TylixChannel {
  send(data: unknown): void
  // Returns an unsubscribe function.
  onMessage(fn: (data: any) => void): () => void
  close(): void
}

declare function useApi(
  path: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    credentials?: RequestCredentials
    // Abort after this many milliseconds. 0 or omitted means no timeout.
    timeout?: number
    signal?: AbortSignal
  },
): Promise<TylixApiResult>
// getApi/postApi/putApi/deleteApi share useApi's response shape --
// convenience wrappers over the same underlying call.
declare function getApi(
  path: string,
  options?: { headers?: Record<string, string> },
): Promise<TylixApiResult>

declare function postApi(
  path: string,
  body?: unknown,
  options?: { headers?: Record<string, string> },
): Promise<TylixApiResult>

declare function putApi(
  path: string,
  body?: unknown,
  options?: { headers?: Record<string, string> },
): Promise<TylixApiResult>

declare function deleteApi(
  path: string,
  options?: { headers?: Record<string, string> },
): Promise<TylixApiResult>

interface ApiOptions {
  headers?: Record<string, string>
  credentials?: RequestCredentials
  timeout?: number
  signal?: AbortSignal
}

declare function useChannel(name: string): TylixChannel

declare function notFound(): void

// Capability names used in page scripts compile to this call.
declare function resolveCapability(name: string): any