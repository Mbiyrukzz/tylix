// packages/compiler/src/typecheck/tylix-globals.d.ts
declare function useApi(
  path: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  },
): Promise<{
  ok: boolean
  status: number
  data: any
  error?: string
}>

// getApi/postApi/putApi/deleteApi share useApi's response shape --
// convenience wrappers over the same underlying call.
declare function getApi(
  path: string,
  options?: { headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: any; error?: string }>

declare function postApi(
  path: string,
  body?: unknown,
  options?: { headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: any; error?: string }>

declare function putApi(
  path: string,
  body?: unknown,
  options?: { headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: any; error?: string }>

declare function deleteApi(
  path: string,
  options?: { headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: any; error?: string }>

declare function useChannel(name: string): any