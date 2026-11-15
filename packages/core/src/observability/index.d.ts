import type { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  method: string
  path: string
}
/** The request being handled, anywhere below its handler. */
export declare const requestContext: AsyncLocalStorage<RequestContext>
export declare function currentRequest(): RequestContext | null

export type LogLevel = 'debug' | 'info' | 'notice' | 'warn' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency' | 'silent'
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
  /** Where entries go. Default: the console. */
  transports?: LogTransport[] | null
}
export interface LogEntry {
  time: Date
  level: Exclude<LogLevel, 'silent' | 'warning'>
  message: string
  fields: Record<string, unknown>
}
export interface LogTransport {
  name?: string
  /** Lowest level this transport writes. */
  level?: LogLevel
  write(entry: LogEntry): void
}
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  notice(message: string, fields?: Record<string, unknown>): void
  warning(message: string, fields?: Record<string, unknown>): void
  critical(message: string, fields?: Record<string, unknown>): void
  alert(message: string, fields?: Record<string, unknown>): void
  emergency(message: string, fields?: Record<string, unknown>): void
  log(level: Exclude<LogLevel, 'silent'>, message: string, fields?: Record<string, unknown>): void
  /** A logger that adds these fields to every entry. */
  child(fields: Record<string, unknown>): Logger
  /** The same logger, writing to these transports instead. */
  withTransports(transports: LogTransport[]): Logger
  /** Adds fields to every later entry of this logger and its children. */
  withContext(fields: Record<string, unknown>): Logger
  withoutContext(keys?: string[]): Logger
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

export interface LoggingSettings {
  default?: string
  channels?: Record<string, { driver: string; [key: string]: unknown }>
  /** Shortcut for channels.stack.channels. */
  stack?: string[]
}
export declare const DEFAULT_LOG_PATH: string
export declare const DEFAULT_LOG_CHANNELS: Record<string, { driver: string; [key: string]: unknown }>
/** Points the app logger at logging.default. */
export declare function configureLogging(settings?: LoggingSettings, options?: { baseDir?: string; environment?: string }): { default: string; transports: LogTransport[] }
/** One Laravel-style line: [2026-11-15 10:22:01] local.ERROR: message {context} {extra} */
export declare function formatLogLine(entry: LogEntry, environment?: string): string
export declare function dailyLogPath(basePath: string, date?: Date): string
export declare function logFiles(): Array<{ channel: string; path: string; base: string; daily: boolean }>
export declare function flushLogFiles(): void
type LogMethod = (message: string, context?: Record<string, unknown>) => void
export declare const Log: {
  debug: LogMethod
  info: LogMethod
  notice: LogMethod
  warning: LogMethod
  warn: LogMethod
  error: LogMethod
  critical: LogMethod
  alert: LogMethod
  emergency: LogMethod
  log(level: Exclude<LogLevel, 'silent'>, message: string, context?: Record<string, unknown>): void
  /** Writes to one named channel only. */
  channel(name: string): Logger
  /** Writes to several channels. */
  stack(names: string[]): Logger
  /** A channel defined on the spot. */
  build(config: { driver: string; name?: string; [key: string]: unknown }): Logger
  withContext(context: Record<string, unknown>): typeof Log
  withoutContext(keys?: string[]): typeof Log
  /** Registers a driver for logging.channels.*.driver. */
  extend(driver: string, factory: (config: any, context: { baseDir: string; environment: string }) => LogTransport | ((entry: LogEntry) => void)): typeof Log
  flush(): void
}
