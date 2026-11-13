export declare const cache: {
  set<T>(key: string, value: T, ttlSeconds?: number | null): Promise<T>
  get<T = unknown>(key: string): Promise<T | null>
  has(key: string): Promise<boolean>
  forget(key: string): Promise<boolean>
  clear(prefix?: string | null): Promise<number>
  /** The cached value, or compute() it, cache it for ttlSeconds and return it. */
  remember<T>(key: string, ttlSeconds: number | null, compute: () => T | Promise<T>): Promise<T>
}
