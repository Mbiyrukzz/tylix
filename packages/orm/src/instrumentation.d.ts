export interface QueryEvent {
  driver: string
  sql: string
  durationMs: number
  error?: unknown
}
/** Called after every SQL statement; returns a function that removes the listener. */
export function onQuery(listener: (event: QueryEvent) => void): () => void
export function hasQueryListeners(): boolean
export function emitQuery(event: QueryEvent): void
