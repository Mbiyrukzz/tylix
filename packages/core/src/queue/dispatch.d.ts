export interface DispatchOptions {
  /** Seconds before the job may run. Needs the available_at column (tylix make:queue-retries). */
  delay?: number
}
export declare function dispatch(
  jobName: string,
  payload?: Record<string, unknown>,
  options?: DispatchOptions,
): Promise<unknown>

export type Backoff = number | number[] | 'exponential' | ((attempt: number) => number)
export interface JobContext {
  id: number | string
  /** 1 on the first run. */
  attempt: number
  tries: number
}
export interface JobHandler<P = Record<string, unknown>> {
  /** Attempts in total. Default: queue.tries in tylix.config (1). */
  tries?: number
  /** Seconds to wait before each retry. */
  backoff?: Backoff
  /** Cap for exponential backoff, seconds. Default 3600. */
  maxBackoff?: number
  /** Seconds an attempt may take before it counts as failed. 0: no limit. */
  timeout?: number
  handle(payload: P, job: JobContext): unknown | Promise<unknown>
  /** Called once, after the last attempt failed. */
  failed?(payload: P, error: Error, job: JobContext): unknown | Promise<unknown>
}
export interface JobOptions {
  tries: number
  backoff: Backoff
  maxBackoff: number
  timeout: number
}
export declare class PermanentJobError extends Error {
  retryable: false
}
export declare class JobTimeoutError extends Error {}
export declare const QUEUE_DEFAULTS: JobOptions
export declare function jobOptions(handler?: Partial<JobHandler>, defaults?: Partial<JobOptions>): JobOptions
export declare function backoffSeconds(options: JobOptions, attempt: number, random?: () => number): number
export declare function afterFailure(
  options: JobOptions,
  attempt: number,
  error: unknown,
  now?: number,
): { retry: false; attempt: number } | { retry: true; attempt: number; delaySeconds: number; availableAt: Date }
export declare function runWithTimeout<T>(work: () => Promise<T>, seconds: number): Promise<T>
