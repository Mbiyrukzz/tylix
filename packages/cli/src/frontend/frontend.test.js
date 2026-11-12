import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveExport, resolveFromProject, createProjectImporter } from './importFromProject.js'
import { resolveFrontendDriver, NATIVE_DRIVER } from './frontendHost.js'

test('resolveExport handles the export-map forms real packages use', () => {
  assert.equal(resolveExport({ exports: './dist/index.js' }, '.'), './dist/index.js')
  assert.equal(resolveExport({ exports: { import: './esm.js', require: './cjs.cjs' } }, '.'), './esm.js')
  assert.equal(
    resolveExport({ exports: { '.': { types: './a.d.ts', default: './a.js' }, './adapter': './adapter.js' } }, './adapter'),
    './adapter.js',
  )
  assert.equal(
    resolveExport({ exports: { '.': { node: { import: './node.mjs' }, default: './browser.js' } } }, '.'),
    './node.mjs',
  )
  assert.equal(resolveExport({ exports: { './features/*': './src/features/*.js' } }, './features/x'), './src/features/x.js')
  assert.equal(resolveExport({ exports: { '.': './a.js' } }, './private'), null)
  assert.equal(resolveExport({ main: 'lib/main.js' }, '.'), 'lib/main.js')
  assert.equal(resolveExport({ exports: { '.': { types: './only.d.ts' } } }, '.'), null)
})

test('resolveFromProject finds packages by walking up node_modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-resolve-'))
  try {
    const pkgDir = path.join(root, 'node_modules', '@scope', 'esm-only')
    await fs.mkdir(pkgDir, { recursive: true })
    await fs.writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@scope/esm-only', type: 'module', exports: { '.': { import: './index.js' }, './sub': './sub.js' } }),
    )
    await fs.writeFile(path.join(pkgDir, 'index.js'), 'export default 42\n')
    await fs.writeFile(path.join(pkgDir, 'sub.js'), 'export const name = "sub"\n')

    const project = path.join(root, 'apps', 'demo')
    await fs.mkdir(project, { recursive: true })

    assert.equal(await resolveFromProject(project, '@scope/esm-only'), path.join(pkgDir, 'index.js'))
    assert.equal(await resolveFromProject(project, 'not-installed'), null)

    const importFromProject = createProjectImporter(project)
    assert.equal((await importFromProject('@scope/esm-only')).default, 42)
    assert.equal((await importFromProject('@scope/esm-only/sub')).name, 'sub')
    await assert.rejects(importFromProject('not-installed'), { code: 'TYLIX_MISSING_PACKAGE' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('the native frontend stays the default', () => {
  assert.equal(resolveFrontendDriver({}), NATIVE_DRIVER)
  assert.equal(resolveFrontendDriver({ frontend: {} }), NATIVE_DRIVER)
  assert.equal(resolveFrontendDriver(undefined), NATIVE_DRIVER)
  assert.equal(resolveFrontendDriver({ frontend: { driver: 'react' } }), 'react')
  assert.equal(resolveFrontendDriver({ frontend: { driver: 'svelte' } }), 'svelte')
  assert.equal(resolveFrontendDriver({ frontend: { driver: 'vue' } }), 'vue')
  assert.equal(resolveFrontendDriver({ frontend: { driver: 'angular' } }), 'angular')
})

test('an unknown driver is a clear config error', () => {
  assert.throws(() => resolveFrontendDriver({ frontend: { driver: 'reakt' } }), /frontend\.driver "reakt" is unknown.*tylix, react, svelte, vue, angular/)
})
