// Framework compatibility matrix: each frontend adapter's unit tests, run
// against the oldest and newest major its peerDependencies accept.
//
//   node scripts/compat-matrix.mjs                  every row
//   node scripts/compat-matrix.mjs --only angular   one adapter
//
// Each row installs its framework versions into a throwaway folder (a copy
// of the adapter and @tylix/client), so the monorepo's own node_modules are
// never touched. Rows mirror the peer ranges: widen one, add a row here.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSDOM = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'compiler', 'package.json'), 'utf8')).devDependencies.jsdom

const angular = (range) => ({
  '@angular/common': range,
  '@angular/compiler': range,
  '@angular/core': range,
  '@angular/platform-browser': range,
  '@angular/platform-server': range,
  '@angular/router': range,
  rxjs: '^7.8.0',
})

const ROWS = [
  { adapter: 'react', label: 'React 18', deps: { react: '^18.2.0', 'react-dom': '^18.2.0' } },
  { adapter: 'react', label: 'React 19', deps: { react: '^19.0.0', 'react-dom': '^19.0.0' } },
  { adapter: 'vue', label: 'Vue 3.4', deps: { vue: '~3.4.0' } },
  { adapter: 'vue', label: 'Vue 3 (latest)', deps: { vue: '^3.4.0' } },
  { adapter: 'svelte', label: 'Svelte 5 (latest)', deps: { svelte: '^5.0.0' } },
  { adapter: 'angular', label: 'Angular 20', deps: angular('^20.0.0') },
  { adapter: 'angular', label: 'Angular 22', deps: angular('^22.0.0') },
]

const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > -1 ? process.argv[onlyArg + 1].split(',') : null
const rows = ROWS.filter((r) => !only || only.includes(r.adapter))

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) })
}

const results = []
for (const row of rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tylix-compat-${row.adapter}-`))
  process.stdout.write(`${row.label.padEnd(20)} `)
  try {
    // Same layout as the monorepo: tests reach ../../client/src.
    copy(path.join(ROOT, 'packages', row.adapter), path.join(dir, 'packages', row.adapter))
    copy(path.join(ROOT, 'packages', 'client'), path.join(dir, 'packages', 'client'))
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'tylix-compat',
        private: true,
        type: 'module',
        dependencies: { ...row.deps, jsdom: JSDOM, '@tylix/client': 'file:./packages/client' },
      }),
    )
    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8' })
    if (install.status !== 0) throw new Error(`npm install failed\n${install.stderr}`)
    const versions = Object.keys(row.deps)
      .filter((d) => !d.startsWith('@angular/') || d === '@angular/core')
      .map((d) => `${d}@${JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', d, 'package.json'), 'utf8')).version}`)
    const tests = fs.readdirSync(path.join(dir, 'packages', row.adapter, 'src')).filter((f) => f.endsWith('.test.js'))
    const run = spawnSync(process.execPath, ['--test', ...tests.map((t) => `src/${t}`)], {
      cwd: path.join(dir, 'packages', row.adapter),
      encoding: 'utf8',
    })
    const pass = /# pass (\d+)/.exec(run.stdout)?.[1] ?? '0'
    const fail = /# fail (\d+)/.exec(run.stdout)?.[1] ?? '?'
    const ok = run.status === 0
    console.log(`${ok ? '✔' : '✘'} ${pass} passed, ${fail} failed  (${versions.join(', ')})`)
    if (!ok) console.log(run.stdout.split('\n').filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 12).join('\n'))
    results.push(ok)
  } catch (err) {
    console.log(`✘ ${err.message}`)
    results.push(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

process.exitCode = results.every(Boolean) ? 0 : 1
