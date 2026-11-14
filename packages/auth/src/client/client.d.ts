import type { PublicSession } from '../web.js'
export interface AuthClient {
  /** fetch() with credentials that refreshes once on 401 and replays the request. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  refresh(): Promise<boolean>
  session(): Promise<{ userId: string | number; session: PublicSession | null; user?: unknown } | null>
  sessions(): Promise<PublicSession[]>
  revokeSession(id: string): Promise<boolean>
  signOut(options?: { everywhere?: boolean }): Promise<void>
  /** Fires in every tab when any tab signs out or a refresh fails. */
  onSignOut(listener: () => void): () => void
  close(): void
}
export declare function createAuthClient(options?: { baseUrl?: string; basePath?: string; fetch?: typeof fetch; onSignOut?: () => void }): AuthClient
