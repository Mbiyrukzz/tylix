// Bundles the extension and the language server into dist/:
//   dist/extension.cjs   the VS Code client
//   dist/server.cjs      packages/language-server with @tylix/compiler
//                        and TypeScript inlined
//   dist/lib.*.d.ts      TypeScript's standard library (the checker
//                        looks for it next to the bundle)
//   dist/tylix-globals.d.ts
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.resolve(HERE, '..')
const ROOT = path.resolve(EXT, '..', '..')
const DIST = path.join(EXT, 'dist')
const require = createRequire(path.join(ROOT, 'packages', 'language-server', 'package.json'))

fs.rmSync(DIST, { recursive: true, force: true })
fs.mkdirSync(DIST, { recursive: true })

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning', legalComments: 'none' }

await esbuild.build({
  ...common,
  entryPoints: [path.join(EXT, 'src', 'extension.js')],
  outfile: path.join(DIST, 'extension.cjs'),
  external: ['vscode'],
})

// The server's ESM sources use import.meta.url to find files next to
// them; in the CJS bundle that is the bundle itself.
await esbuild.build({
  ...common,
  entryPoints: [path.join(ROOT, 'packages', 'language-server', 'src', 'bin.js')],
  outfile: path.join(DIST, 'server.cjs'),
  define: { 'import.meta.url': '__tylixBundleUrl' },
  banner: { js: "const __tylixBundleUrl = require('node:url').pathToFileURL(__filename).href;" },
})

const tsLib = path.join(path.dirname(require.resolve('typescript')))
for (const f of fs.readdirSync(tsLib)) {
  if (/^lib\..*\.d\.ts$/.test(f)) fs.copyFileSync(path.join(tsLib, f), path.join(DIST, f))
}
const compilerDir = path.dirname(require.resolve('@tylix/compiler'))
fs.copyFileSync(
  path.join(compilerDir, 'typecheck', 'tylix-globals.d.ts'),
  path.join(DIST, 'tylix-globals.d.ts'),
)

const size = (f) => `${(fs.statSync(path.join(DIST, f)).size / 1024 / 1024).toFixed(1)} MB`
console.log(`built dist/extension.cjs (${size('extension.cjs')}), dist/server.cjs (${size('server.cjs')})`)
