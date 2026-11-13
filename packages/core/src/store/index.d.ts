export interface Store {
  readonly driver: 'memory' | 'database' | 'redis'
  /** True when other processes see the same values and messages. */
  readonly shared: boolean
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, options?: { ttlMs?: number }): Promise<void>
  delete(key: string): Promise<void>
  /** Deletes every key starting with prefix; resolves to how many. */
  deletePrefix(prefix: string): Promise<number>
  /** Adds `by` (default 1) atomically and returns the new count; ttlMs applies when the key is new. */
  increment(key: string, options?: { by?: number; ttlMs?: number }): Promise<number>
  publish(channel: string, message: unknown): Promise<void>
  /** Resolves to a function that unsubscribes. */
  subscribe(channel: string, listener: (message: any) => void): Promise<() => Promise<void>>
  close(): Promise<void>
}

export interface StoreOptions {
  driver?: 'memory' | 'database' | 'redis'
  /** For redis. */
  redisUrl?: string
  /** Put in front of every key and channel. */
  prefix?: string
  /** How often the database driver checks for messages. Default 250ms. */
  pollMs?: number
}

export declare function createStore(options?: StoreOptions): Promise<Store>
/** The app's store ("tylix dev" and "tylix start" set it from STORE_DRIVER). */
export declare function getStore(): Store
export declare function setStore(store: Store): void
