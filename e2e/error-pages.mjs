// Error page check for a scaffolded app.
//
//   node e2e/error-pages.mjs <appDir> <baseUrl>                dev: adds a page that throws, checks, removes it
//   node e2e/error-pages.mjs <appDir> <baseUrl> --keep         dev, and leave the page for a production build
//   node e2e/error-pages.mjs <appDir> <baseUrl> --production   against `tylix start`, page already built in
//
// Hosted frontends: "tylix make:page Crash" adds /crash, which is then made
// to throw while rendering. The starter's error boundary must show its
// error page (the navbar still works, and leaving the page clears it);
// development shows the error, production does not. The server must not
// answer the page with a broken document.
// Every app: unknown URLs and server errors reach a browser as pages, and
// API clients keep JSON.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createReport, launchBrowser, waitFor } from './lib/browser.mjs'

const appDir = path.resolve(process.argv[2] ?? '.')
const base = (process.argv[3] ?? 'http://localhost:3000').replace(/\/$/, '')
const production = process.argv.includes('--production')
const keep = process.argv.includes('--keep')
const frontendDir = path.join(appDir, 'app', 'views')
const hosted = fs.existsSync(frontendDir)
const CRASH = 'E2E_CRASH_CHECK'

// Snapshot of the frontend sources, to undo make:page afterwards.
function snapshot(dir, out = new Map()) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) snapshot(full, out)
    else out.set(full, fs.readFileSync(full, 'utf8'))
  }
  return out
}
function restoreSnapshot(dir, before) {
  for (const [file] of snapshot(dir)) if (!before.has(file)) fs.rmSync(file)
  for (const [file, content] of before) if (fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content)
}

// A guarded throw, so type checkers don't flag the rest as unreachable.
const THROW = `const crash = true\n  if (crash) throw new Error('${CRASH}')`
const CRASH_FILES = ['Crash.tsx', 'Crash.jsx', 'Crash.vue', 'Crash.svelte', 'crash.ts']
const crashFile = () => CRASH_FILES.map((f) => path.join(frontendDir, 'pages', f)).find((f) => fs.existsSync(f))

function makeCrashPage() {
  // Already there from an earlier --keep run (frontends.mjs --reuse).
  const existing = crashFile()
  if (existing && fs.readFileSync(existing, 'utf8').includes(CRASH)) return
  execFileSync(process.execPath, [path.join(appDir, 'node_modules', '@tylix', 'cli', 'src', 'index.js'), 'make:page', 'Crash'], {
    cwd: appDir,
    stdio: 'pipe',
  })
  const file = crashFile()
  if (!file) throw new Error('make:page Crash wrote no page')
  let source = fs.readFileSync(file, 'utf8')
  if (file.endsWith('crash.ts')) source = source.replace(/export class Crash \{/, `export class Crash {\n  constructor() {\n  ${THROW}\n  }`)
  else if (/\.(tsx|jsx)$/.test(file)) source = source.replace(/export default function Crash\(\) \{/, `export default function Crash() {\n  ${THROW}`)
  else source = source.replace(/<script( setup)?( lang="ts")?>/, (tag) => `${tag}\n  ${THROW}`)
  if (!source.includes(CRASH)) throw new Error(`could not add the throw to ${file}`)
  fs.writeFileSync(file, source)
}

const html = { headers: { Accept: 'text/html' } }
const report = createReport(`Error pages against ${base} (${hosted ? 'hosted frontend' : 'native pages'}, ${production ? 'production' : 'dev'})`)
const before = hosted ? snapshot(frontendDir) : null
const browser = await launchBrowser()

try {
  await waitFor(() => fetch(`${base}/`, html).then((r) => r.status < 500), { timeout: 60000, what: 'the server' })

  await report.step('an unknown API URL answers JSON 404', async () => {
    const res = await fetch(`${base}/api/e2e-does-not-exist`)
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`)
    const body = await res.json()
    if (!body.error) throw new Error(`no error in ${JSON.stringify(body)}`)
  })

  await report.step('a malformed URL gives a browser a 400 page, not JSON', async () => {
    const res = await fetch(`${base}/%E0%A4%A`, { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } })
    // Hosted frontends hand unknown URLs to their router, which may answer
    // with its own 404; either way it must be a page.
    if (res.status >= 500) throw new Error(`got ${res.status}`)
    if (!/text\/html/.test(res.headers.get('content-type') ?? '')) throw new Error(`content-type ${res.headers.get('content-type')}`)
  })

  if (hosted) {
    if (!production) {
      await report.step('make:page adds a page, made to throw while rendering', async () => {
        makeCrashPage()
        // Vite picks up the new page and route; no restart involved.
        await waitFor(() => fetch(`${base}/crash`, html).then((r) => r.status !== 404), { what: '/crash to exist' })
      })
    }

    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await report.step('the server answers the broken page without crashing', async () => {
      const res = await fetch(`${base}/crash`, html)
      const body = await res.text()
      // Either the server rendered the error page (500), or rendering
      // failed and the browser gets the page to render itself (200).
      if (![200, 500].includes(res.status)) throw new Error(`status ${res.status}`)
      if (!body.includes('</html>')) throw new Error('incomplete document')
      if (production && body.includes(CRASH)) throw new Error('production HTML leaks the error message')
    })

    await report.step("the starter's error page replaces the broken page", async () => {
      await page.goto(`${base}/crash`)
      // Dev opens Vite's overlay when server rendering failed; close it.
      if (!production) await page.keyboard.press('Escape').catch(() => {})
      const errorPage = page.getByTestId('error-page')
      await errorPage.waitFor({ timeout: 15000 })
      await errorPage.getByRole('heading', { name: 'Something went wrong' }).waitFor()
      const shown = await errorPage.innerText()
      if (!production && !shown.includes(CRASH)) throw new Error('dev error page does not show the error')
      if (production && shown.includes(CRASH)) throw new Error('production error page shows the error message')
    })

    await report.step('leaving the broken page clears the error', async () => {
      await page.evaluate(() => document.querySelector('vite-error-overlay')?.remove())
      await page.getByTestId('error-page').getByRole('link', { name: 'Go home' }).click()
      await page.waitForURL(`${base}/`)
      await page.getByRole('heading', { name: /ready/ }).first().waitFor()
      if (await page.getByTestId('error-page').count()) throw new Error('error page still shown')
    })

    await report.step('no page errors escaped the error boundary', async () => {
      const escaped = pageErrors.filter((m) => !m.includes(CRASH))
      if (escaped.length) throw new Error(escaped.join('\n'))
    })
  } else {
    await report.step('an unknown URL renders the app 404 page with status 404', async () => {
      const res = await fetch(`${base}/e2e/does/not/exist`, html)
      if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`)
    })

    if (!production) {
      const file = path.join(appDir, 'app', 'pages', 'ErrorCheck.tyx')
      await report.step('a page with a template error shows the dev error page, naming the file', async () => {
        fs.writeFileSync(file, `page ErrorCheck\n\ntemplate\n  <div><p>mismatched</span></div>\n`)
        try {
          const res = await waitFor(async () => {
            const r = await fetch(`${base}/errorcheck`, html)
            return r.status === 404 ? null : r
          }, { timeout: 30000, what: '/errorcheck to be routed' })
          const body = await res.text()
          if (res.status !== 500) throw new Error(`expected 500, got ${res.status}`)
          if (!body.includes('ErrorCheck.tyx')) throw new Error('the error page does not name the file')
        } finally {
          fs.rmSync(file, { force: true })
        }
      })
    }
  }
} finally {
  if (hosted && !keep && !production) restoreSnapshot(frontendDir, before)
  await browser.close()
  report.print()
  process.exitCode = report.failed ? 1 : 0
}
