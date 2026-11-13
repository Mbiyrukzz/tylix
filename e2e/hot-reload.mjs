// Hot reload check for a scaffolded app running under `tylix dev`: saving a
// file must show up in an open browser tab without restarting anything.
//
//   node e2e/hot-reload.mjs <appDir> <baseUrl>
//
// Hosted frontends (app/frontend): a page edit reaches the open tab (Vite
// HMR) and the next server render; a backend edit restarts the server and
// the open tab reloads once it is back.
// Native .tyx pages: page, component, app/loading.tyx and stylesheet edits
// reload the tab; a new page is routed without a manual restart.
//
// Every file it touches is put back afterwards.
import fs from 'node:fs'
import path from 'node:path'
import { createReport, launchBrowser, sleep, waitFor } from './lib/browser.mjs'

const appDir = path.resolve(process.argv[2] ?? '.')
const base = (process.argv[3] ?? 'http://localhost:3000').replace(/\/$/, '')
const hosted = fs.existsSync(path.join(appDir, 'app', 'frontend'))
const MARK = `HMR-${Date.now()}`

const originals = new Map()
function edit(rel, change) {
  const file = path.join(appDir, rel)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (!originals.has(file)) originals.set(file, before)
  fs.writeFileSync(file, change(before ?? ''))
}
function restore() {
  for (const [file, content] of originals) {
    if (content === null) fs.rmSync(file, { force: true })
    else fs.writeFileSync(file, content)
  }
}

function findFile(dir, test) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(full, test)
      if (found) return found
    } else if (test(entry.name, full)) {
      return full
    }
  }
  return null
}

const rel = (file) => path.relative(appDir, file)
const serverHtml = async (url) => (await fetch(`${base}${url}`, { headers: { Accept: 'text/html' } })).text()

const report = createReport(`Hot reload against ${base} (${hosted ? 'hosted frontend' : 'native pages'})`)
const browser = await launchBrowser()
const page = await browser.newPage()

try {
  await waitFor(() => fetch(`${base}/`, { headers: { Accept: 'text/html' } }).then((r) => r.ok), { timeout: 60000, what: 'the dev server' })
  await page.goto(`${base}/`)
  await page.waitForLoadState('networkidle')

  if (hosted) {
    const homeFile = findFile(path.join(appDir, 'app', 'frontend', 'pages'), (name) => /^home\.(tsx|jsx|vue|svelte|ts)$/i.test(name))
    const heading = 'Your full-stack app is ready.'

    await report.step('a saved page shows up in the open tab', async () => {
      edit(rel(homeFile), (s) => s.replace(heading, `${MARK} ready.`))
      await page.getByText(`${MARK} ready.`).waitFor({ timeout: 15000 })
    })

    await report.step('the next server render has the change too', async () => {
      await waitFor(async () => (await serverHtml('/')).includes(MARK), { what: 'the server-rendered page to change' })
    })

    await report.step('a saved backend file restarts the server and reloads the open tab', async () => {
      await page.evaluate(() => {
        window.__beforeRestart = true
      })
      const controller = findFile(path.join(appDir, 'app', 'controllers'), (name) => /\.(ts|js)$/.test(name))
      edit(rel(controller), (s) => `${s}\n// hot reload check ${MARK}\n`)
      await waitFor(
        () => page.evaluate(() => window.__beforeRestart === undefined).catch(() => false),
        { timeout: 30000, what: 'the tab to reload after the restart' },
      )
      await page.getByText(`${MARK} ready.`).waitFor({ timeout: 15000 })
    })
  } else {
    // Native pages: the dev server reloads the tab over /__tylix/hmr.
    const reloaded = async (fn, what) => {
      await page.evaluate(() => {
        window.__beforeReload = true
      })
      await fn()
      await waitFor(() => page.evaluate(() => window.__beforeReload === undefined).catch(() => false), {
        timeout: 20000,
        what,
      })
      await page.waitForLoadState('load')
    }

    const pagesDir = path.join(appDir, 'app', 'pages')
    const homeFile = path.join(pagesDir, 'Home.tyx')
    await report.step('a saved page reloads the open tab with the change', async () => {
      await reloaded(() => edit(rel(homeFile), (s) => s.replace(/^template\n/m, `template\n  <p>${MARK}-page</p>\n`)), 'a reload')
      await page.getByText(`${MARK}-page`).waitFor()
    })

    const component = findFile(path.join(pagesDir, 'components'), (name) => name.endsWith('.tyx'))
    if (component) {
      await report.step('a saved component reloads the open tab', async () => {
        await reloaded(() => edit(rel(component), (s) => `${s}\n`), 'a reload')
      })
    }

    for (const file of ['app/loading.tyx', 'app/index.html', 'app/tailwind-input.css']) {
      if (!fs.existsSync(path.join(appDir, file))) continue
      await report.step(`saving ${file} reloads the open tab`, async () => {
        await reloaded(() => edit(file, (s) => `${s}\n`), 'a reload')
      })
    }

    await report.step('a new page is routed without restarting by hand', async () => {
      edit('app/pages/HotReloadCheck.tyx', () => `page HotReloadCheck\n\ntemplate\n  <h1>${MARK}-new</h1>\n`)
      await waitFor(async () => (await serverHtml('/hotreloadcheck')).includes(`${MARK}-new`), {
        timeout: 30000,
        what: '/hotreloadcheck to be served',
      })
    })
  }
} finally {
  restore()
  await sleep(hosted ? 500 : 300)
  await browser.close()
  report.print()
  process.exitCode = report.failed ? 1 : 0
}
