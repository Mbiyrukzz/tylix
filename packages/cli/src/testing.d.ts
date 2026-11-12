export interface TestResponse<T = any> {
  status: number
  data: T
}

export interface RequestOptions {
  body?: unknown
  /** A user id, or a user object with an id: the request is made as them. */
  as?: number | string | { id: number | string } | null
  headers?: Record<string, string>
}

export interface TestClient {
  app: unknown
  request<T = any>(method: string, url: string, options?: RequestOptions): Promise<TestResponse<T>>
  get<T = any>(url: string, options?: RequestOptions): Promise<TestResponse<T>>
  post<T = any>(url: string, body?: unknown, options?: RequestOptions): Promise<TestResponse<T>>
  put<T = any>(url: string, body?: unknown, options?: RequestOptions): Promise<TestResponse<T>>
  patch<T = any>(url: string, body?: unknown, options?: RequestOptions): Promise<TestResponse<T>>
  delete<T = any>(url: string, options?: RequestOptions): Promise<TestResponse<T>>
  close(): Promise<void>
}

/** Builds the app's API in-process (no frontend) for tests. */
export function createTestClient(options?: { baseDir?: string }): Promise<TestClient>
