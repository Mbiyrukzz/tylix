export declare const cache: {
  set(key: string, value: unknown, ttlSeconds?: number | null): Promise<unknown>
  get<T = unknown>(key: string): Promise<T | null>
  has(key: string): Promise<boolean>
  forget(key: string): Promise<boolean>
  clear(prefix?: string | null): Promise<number>
}