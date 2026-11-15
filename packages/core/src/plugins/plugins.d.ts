import type { Router } from '../router/Router.js'
import type { Logger, LogEntry, LogTransport } from '../observability/index.js'

export type PluginHook = 'config' | 'register' | 'routes' | 'boot' | 'close'
export declare const PLUGIN_HOOKS: PluginHook[]

export interface PluginContext {
  name: string
  baseDir: string
  config: Record<string, any>
  production: boolean
  /** The app router (routes registered here show in the dev banner). */
  router: Router
  /** Global middleware: router.use(). */
  use(middleware: (req: any, res: any, next: () => unknown) => unknown): void
  /** Wraps a handler so it needs a signed-in user. */
  auth<H extends (...args: any[]) => any>(handler: H): H
  /** A logger whose entries carry { plugin: name }. */
  logger: Logger
  addReadinessCheck(name: string, check: () => unknown | Promise<unknown>, options?: { timeoutMs?: number }): () => void
}

export interface PluginCommand {
  description?: string
  usage?: string
  run(args: string[], context: { baseDir: string; config: Record<string, any> }): unknown | Promise<unknown>
}

export interface DeployAdapterContext {
  baseDir: string
  config: Record<string, any>
  language: 'typescript' | 'javascript'
  packageManager: string
  appName: string
  /** Static export (tylix export) instead of a Node server. */
  static: boolean
}
export interface DeployAdapter {
  name: string
  label: string
  /** Files to write, relative to the project root. */
  files(context: DeployAdapterContext): Record<string, string> | Promise<Record<string, string>>
  /** Printed after the files are written. */
  nextSteps?(context: DeployAdapterContext): string[]
  /** Hosts that only serve files: needs a static export. */
  static?: boolean
}

export interface TylixPlugin {
  name?: string
  /** Change the config before the app starts. Return keys to merge, or change it in place. */
  config?(config: Record<string, any>): void | Record<string, any> | Promise<void | Record<string, any>>
  /** Before the app's routes: middleware, readiness checks, services. */
  register?(context: PluginContext): unknown | Promise<unknown>
  /** After the app's API routes, before pages. */
  routes?(router: Router, context: PluginContext): unknown | Promise<unknown>
  /** Once the app is built. */
  boot?(app: any): unknown | Promise<unknown>
  /** On shutdown, in reverse order. */
  close?(): unknown | Promise<unknown>
  logDrivers?: Record<string, (config: any, context: { baseDir: string; environment: string }) => LogTransport | ((entry: LogEntry) => void)>
  commands?: Record<string, PluginCommand>
  deployAdapters?: Record<string, DeployAdapter>
}

export interface LoadedPlugin extends TylixPlugin {
  name: string
  source: string
}

export declare function definePlugin<P extends TylixPlugin>(plugin: P): P
export declare function loadPlugins(baseDir: string, config?: { plugins?: unknown[] }): Promise<LoadedPlugin[]>
export declare function createPluginHost(plugins?: LoadedPlugin[]): {
  plugins: LoadedPlugin[]
  applyConfig<C extends Record<string, any>>(config: C): Promise<C>
  run(hook: PluginHook, ...args: unknown[]): Promise<void>
  runWith(hook: PluginHook, makeArgs: (plugin: LoadedPlugin) => unknown[]): Promise<void>
  close(): Promise<void>
  collect<K extends 'commands' | 'logDrivers' | 'deployAdapters'>(property: K): Map<string, { plugin: string; value: NonNullable<TylixPlugin[K]>[string] }>
  describe(): Array<{ name: string; source: string; hooks: PluginHook[]; commands: string[]; logDrivers: string[]; deployAdapters: string[] }>
}
