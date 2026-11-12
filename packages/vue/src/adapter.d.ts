export interface FrontendAdapter {
  name: string
  label: string
  root: string
  dedupe: string[]
  requires: string[]
  vitePlugins(context: { importFromProject(specifier: string): Promise<any> }): Promise<unknown[]>
  typecheck?: { bin: string; args(tsconfig: string): string[] }
}

declare const adapter: FrontendAdapter
export default adapter
