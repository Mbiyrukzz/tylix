
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

declare function useApi(
  path: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
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

declare function useChannel(name: string): any

declare function notFound(): void