export interface FrontendAdapter {
  name: string
  label: string
  root: string
  dedupe: string[]
  requires: string[]
  vitePlugins(context: { importFromProject(specifier: string): Promise<any>; root: string }): Promise<unknown>
  typecheck?: { bin: string; args(tsconfig: string): string[] }
  ssr?: boolean
  ssrFallback?: string
  viteConfig?: Record<string, unknown>
}

declare const adapter: FrontendAdapter
export default adapter
