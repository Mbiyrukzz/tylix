import type { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  method: string
  path: string
}
/** The request being handled, anywhere below its handler. */
export declare const requestContext: AsyncLocalStorage<RequestContext>
export declare function currentRequest(): RequestContext | null

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
export interface LoggerOptions {
  level?: LogLevel
  /** json: one JSON line per entry (production); pretty: one readable line. */
  format?: 'json' | 'pretty'
  stream?: { write(text: string): unknown }
  errorStream?: { write(text: string): unknown }
  colors?: boolean
  /** Batch writes once per event-loop turn (default true). */
  buffer?: boolean
  base?: Record<string, unknown>
}
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  /** A logger that adds these fields to every entry. */
  child(fields: Record<string, unknown>): Logger
  isLevelEnabled(level: LogLevel): boolean
  /** Changes this logger and its children. */
  configure(options: LoggerOptions): void
}
export declare const LOG_LEVELS: Record<LogLevel, number>
export declare function createLogger(options?: LoggerOptions): Logger
/** The app's logger. */
export declare const logger: Logger

export type Labels = Record<string, string | number>
export interface Counter {
  inc(labels?: Labels, by?: number): void
}
export interface Gauge {
  set(value: number, labels?: Labels): void
}
export interface Histogram {
  observe(value: number, labels?: Labels): void
}
export interface MetricsRegistry {
  counter(name: string, help: string): Counter
  gauge(name: string, help: string, collect?: () => number | Array<{ labels?: Labels; value: number }>): Gauge
  histogram(name: string, help: string, buckets?: number[]): Histogram
  /** Prometheus text format. */
  render(): string
  reset(): void
}
export declare const DEFAULT_BUCKETS: number[]
export declare function createRegistry(): MetricsRegistry
/** The app's metrics, served at /metrics when METRICS=true. */
export declare const metrics: MetricsRegistry

/** A check for /ready: passes by returning, fails by throwing or timing out. Returns a function that removes it. */
export declare function addReadinessCheck(name: string, check: () => unknown | Promise<unknown>, options?: { timeoutMs?: number }): () => void
export declare function runReadinessChecks(): Promise<{
  ok: boolean
  checks: Record<string, { ok: boolean; ms: number; error?: string }>
}>
