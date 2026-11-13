// Developer-tooling checks for a native (.tyx) app running under
// `tylix dev`:
//
//   node e2e/dev-tools.mjs <appDir> <baseUrl>
//
//   - `tylix check` passes on the untouched starter
//   - a compile error in a component is shown with its own file, line
//     and column, and the error page reloads itself once the file is fixed
//   - a page script error and a type error are placed on the right line
//   - uncaught browser errors show the runtime error overlay
//   - the Tylix DevTools panel (devtools/extension) reads and edits the
//     live app
//
// Every file it touches is put back afterwards.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createReport, launchBrowser, sleep, waitFor } from './lib/browser.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.resolve(process.argv[2] ?? '.')
const base = (process.argv[3] ?? 'http://localhost:3000').replace(/\/$/, '')
const report = createReport(`Developer tooling: ${base}`)

const originals = new Map()
function edit(rel, from, to) {
  const file = path.join(appDir, rel)
  const text = fs.readFileSync(file, 'utf8')
  if (!originals.has(file)) originals.set(file, text)
  if (!text.includes(from)) throw new Error(`${rel} no longer contains ${JSON.stringify(from)}`)
  fs.writeFileSync(file, text.replace(from, to))
}
function restore() {
  for (const [file, text] of originals) fs.writeFileSync(file, text)
  originals.clear()
}

const cli = path.join(appDir, 'node_modules', '@tylix', 'cli', 'src', 'index.js')
const browser = await launchBrowser()
const page = await browser.newPage()

try {
  await report.step('tylix check passes on the starter', async () => {
    const r = spawnSync(process.execPath, [cli, 'check'], { cwd: appDir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`exit ${r.status}\n${r.stdout}${r.stderr}`)
    if (!/no problems/.test(r.stdout)) throw new Error(r.stdout)
  })

  await report.step('tylix check reports a broken file with its position', async () => {
    edit('app/pages/components/Hero.tyx', '{{#if loggedIn}}', '{{#if loggedIn and }}')
    try {
      const r = spawnSync(process.execPath, [cli, 'check', '--format=github'], { cwd: appDir, encoding: 'utf8' })
      if (r.status !== 1) throw new Error(`expected exit 1, got ${r.status}`)
      if (!/^::error file=app\/pages\/components\/Hero\.tyx,line=\d+,col=\d+/m.test(r.stdout)) throw new Error(r.stdout)
    } finally {
      restore()
    }
  })

  await report.step('component compile error names the component file:line:col', async () => {
    edit('app/pages/components/Hero.tyx', '{{#if loggedIn}}', '{{#if loggedIn and }}')
    await sleep(300)
    await page.goto(`${base}/`)
    const text = await page.textContent('body')
    if (!/app\/pages\/components\/Hero\.tyx:\d+:\d+/.test(text)) throw new Error(text.slice(0, 400))
    if ((await page.locator('mark.frame-hit').count()) !== 1) throw new Error('no underlined span')
    if (!(await page.locator('a[href^="vscode://file/"]').count())) throw new Error('no editor link')
  })

  await report.step('the error page reloads itself when the file is fixed', async () => {
    restore()
    await waitFor(async () => !(await page.textContent('body')).includes('Compile Error'), {
      timeout: 10000,
      what: 'automatic reload',
    })
  })

  await report.step('a page script error is placed on its line', async () => {
    edit('app/pages/posts/Index.tyx', '    const q = this.query.trim().toLowerCase()', '    const q = = this.query')
    await sleep(300)
    await page.goto(`${base}/posts`)
    const text = await page.textContent('body')
    const pos = /app\/pages\/posts\/Index\.tyx:(\d+):(\d+)/.exec(text)
    if (!pos) throw new Error(text.slice(0, 400))
    const lines = originals.get(path.join(appDir, 'app/pages/posts/Index.tyx')).split('\n')
    const expected = lines.findIndex((l) => l.includes('const q = this.query')) + 1
    if (Number(pos[1]) !== expected) throw new Error(`line ${pos[1]}, expected ${expected}`)
    restore()
  })

  await report.step('runtime errors show the overlay', async () => {
    await sleep(1500) // let the reload from the restore above land
    await page.goto(`${base}/posts`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e runtime boom')
      })
    })
    await waitFor(
      async () =>
        page.evaluate(() => document.querySelector('tylix-error-overlay')?.shadowRoot.textContent.includes('e2e runtime boom')),
      { what: 'runtime overlay' },
    )
  })

  await report.step('DevTools panel reads and edits the live app', async () => {
    const ext = path.join(ROOT, 'devtools', 'extension')
    const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: ext, encoding: 'utf8' })
    if (build.status !== 0) throw new Error(build.stdout + build.stderr)
    const r = spawnSync(process.execPath, ['--test', 'test/panel.test.mjs'], {
      cwd: ext,
      encoding: 'utf8',
      env: { ...process.env, TYLIX_DEVTOOLS_APP: base },
    })
    if (r.status !== 0 || /# skipped [1-9]/.test(r.stdout)) throw new Error(r.stdout.split('\n').filter((l) => /not ok|error|waiting/.test(l)).join('\n') || r.stdout)
  })
} finally {
  restore()
  await browser.close()
}

report.print()
process.exit(report.failed ? 1 : 0)
