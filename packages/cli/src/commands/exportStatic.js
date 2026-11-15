import fs from 'node:fs/promises'
import path from 'node:path'
import { Server } from '@tylix/core'
import { exists, loadEnv } from '@tylix/shared'

// tylix export: static site generation.
//
// Runs the production app on a private port, requests every page and
// writes what it answers to dist/static: HTML for pages, plus every
// script, stylesheet and image they reference, plus public/. The result
// can be served by any static host (see "tylix deploy:init").
//
// Which pages: "/" and every page without a parameter, then every link
// found in them (export.crawl: false turns that off), plus
// export.paths for pages with parameters:
//
//   export: {
//     outDir: 'dist/static',
//     paths: async () => (await Post.all()).map((p) => `/posts/${p.id}`),
//     exclude: ['/admin', /^\/drafts\//],
//   }
//
// API routes are not exported: a page that calls the API in the browser
// still needs a backend for that data.

const HTML = /text\/html/
const SKIP_PREFIXES = ['/api/', '/__tylix', '/_tylix/hmr']

export function urlToFile(pathname, isHtml) {
  let clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/'
  if (clean.split('/').some((segment) => segment === '..')) throw new Error(`Refusing to export ${pathname}`)
  if (!isHtml) return clean.slice(1)
  if (clean === '/') return 'index.html'
  if (clean.endsWith('.html')) return clean.slice(1)
  return `${clean.slice(1)}/index.html`
}

// Same-site URLs a page or asset refers to.
export function findReferences(text, type) {
  const found = new Set()
  const add = (url) => {
    if (!url || !url.startsWith('/') || url.startsWith('//')) return
    found.add(url.split('#')[0])
  }
  if (HTML.test(type)) {
    for (const m of text.matchAll(/\b(?:href|src|action|poster|data-src)\s*=\s*["']([^"']+)["']/gi)) add(m[1])
    for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
      for (const part of m[1].split(',')) add(part.trim().split(/\s+/)[0])
    }
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) for (const url of findReferences(m[1], 'text/javascript')) add(url)
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) for (const url of findReferences(m[1], 'text/css')) add(url)
  }
  if (/javascript|ecmascript/.test(type)) {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\/[^"']+)["']/g)) add(m[1])
    for (const m of text.matchAll(/new URL\(\s*["'](\/[^"']+)["']/g)) add(m[1])
  }
  if (/css/.test(type) || HTML.test(type)) {
    for (const m of text.matchAll(/url\(\s*["']?(\/[^"')]+)["']?\s*\)/g)) add(m[1])
    for (const m of text.matchAll(/@import\s+["'](\/[^"']+)["']/g)) add(m[1])
  }
  return [...found]
}

function excluded(pathname, patterns) {
  return patterns.some((p) => (p instanceof RegExp ? p.test(pathname) : pathname === p || pathname.startsWith(`${String(p).replace(/\/$/, '')}/`)))
}

async function copyDir(from, to, { overwrite }) {
  let copied = 0
  const entries = await fs.readdir(from, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copied += await copyDir(source, target, { overwrite })
    else if (entry.isFile()) {
      if (!overwrite && (await exists(target))) continue
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target)
      copied++
    }
  }
  return copied
}

export async function exportStatic({ outDir: outFlag } = {}) {
  process.env.NODE_ENV = 'production'
  const baseDir = process.cwd()
  await loadEnv(baseDir)
  const { createApp } = await import('../server/createApp.js')
  // static: no secret check (an export holds no sessions).
  const app = await createApp(baseDir, { production: true, static: true })
  const settings = app.config.export ?? {}
  const outDir = path.resolve(baseDir, outFlag ?? settings.outDir ?? 'dist/static')
  const exclude = settings.exclude ?? []
  const crawl = settings.crawl !== false

  if (app.frontend.host && !(await exists(path.join(baseDir, 'dist', 'client')))) {
    await app.close()
    throw new Error('Run "tylix build" first: the export copies the built frontend from dist/client.')
  }

  const server = new Server(app.router, {
    notFoundHandler: app.notFoundHandler,
    autoPort: false,
    appUrl: app.config.app.url,
    ...app.serverOptions,
    accessLog: false,
  })
  let http
  const port = await new Promise((resolve) => {
    http = server.listen(0, (actual) => resolve(actual))
  })
  const origin = `http://127.0.0.1:${port}`

  const seeds = new Set(['/'])
  for (const route of app.pageRoutes ?? []) if (!route.includes(':')) seeds.add(route)
  let extra = settings.paths ?? []
  if (typeof extra === 'function') extra = await extra({ pageRoutes: app.pageRoutes, routes: app.routes })
  for (const p of extra) seeds.add(p)

  console.log(`Exporting to ${path.relative(baseDir, outDir) || '.'}...`)
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  const queue = [...seeds]
  const seen = new Set()
  const pages = []
  const assets = []
  const skipped = []

  try {
    while (queue.length) {
      const url = queue.shift()
      const pathname = url.split('?')[0]
      if (seen.has(pathname)) continue
      seen.add(pathname)
      if (SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || excluded(pathname, exclude)) continue

      const res = await fetch(origin + url, { headers: { Accept: 'text/html,*/*' }, redirect: 'manual' })
      const type = res.headers.get('content-type') ?? ''
      if (res.status >= 300 && res.status < 400) {
        skipped.push(`${pathname} (redirects to ${res.headers.get('location')}, e.g. a page that needs sign-in)`)
        continue
      }
      if (res.status !== 200) {
        if (seeds.has(url) || HTML.test(type)) skipped.push(`${pathname} (HTTP ${res.status})`)
        continue
      }
      const isHtml = HTML.test(type)
      const body = Buffer.from(await res.arrayBuffer())
      const file = path.join(outDir, urlToFile(pathname, isHtml))
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, body)
      ;(isHtml ? pages : assets).push(pathname)

      const textual = isHtml || /javascript|css|ecmascript/.test(type)
      if (!textual) continue
      for (const ref of findReferences(body.toString('utf8'), type)) {
        const refPath = ref.split('?')[0]
        const isAsset = /\.[a-z0-9]+$/i.test(refPath)
        // Links to other pages are followed only when crawling; assets
        // (scripts, styles, images) are always fetched.
        if (!isAsset && !crawl) continue
        if (!seen.has(refPath)) queue.push(ref)
      }
    }

    // The not-found page, for hosts that serve 404.html.
    const missing = await fetch(`${origin}/__tylix_export_404__`, { headers: { Accept: 'text/html' } })
    if (HTML.test(missing.headers.get('content-type') ?? '')) {
      await fs.writeFile(path.join(outDir, '404.html'), Buffer.from(await missing.arrayBuffer()))
    }
  } finally {
    http.closeAllConnections?.()
    await new Promise((resolve) => http.close(resolve))
    await app.close()
  }

  const publicCount = await copyDir(path.join(baseDir, 'public'), outDir, { overwrite: false })
  const clientCount = app.frontend.host ? await copyDir(path.join(baseDir, 'dist', 'client'), outDir, { overwrite: false }) : 0

  console.log(`✔ ${pages.length} page(s), ${assets.length + publicCount + clientCount} asset file(s).`)
  for (const page of pages.slice(0, 20)) console.log(`  ${page}`)
  if (pages.length > 20) console.log(`  ... and ${pages.length - 20} more`)
  if (skipped.length) {
    console.log('\nNot exported:')
    for (const s of skipped) console.log(`  ${s}`)
  }
  if (app.routes.some((r) => r.pattern.startsWith('/api/') && r.source !== 'auth')) {
    console.log('\nNote: API routes are not part of a static export. Pages that call them in the browser need the backend running somewhere.')
  }
  return { outDir, pages, assets, skipped }
}
