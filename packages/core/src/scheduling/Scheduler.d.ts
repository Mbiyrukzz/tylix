export declare class Scheduler {
  every(interval: string, handler: () => Promise<void>): this
  daily(time: string, handler: () => Promise<void>): this
  runDue(): Promise<void>
}