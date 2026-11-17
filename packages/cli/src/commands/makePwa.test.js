import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makePwa, patchConfig, patchLayout } from './makePwa.js'
import { createPwa } from '../server/pwa.js'

test('patchConfig adds a pwa block once', () => {
  const src = 'import { defineConfig } from "@tylix/shared";\n\nexport default defineConfig({\n  plugins: [],\n});\n'
  const out = patchConfig(src, 'Acme')
  assert.match(out, /defineConfig\(\{\n  \/\/ Installable app[\s\S]*pwa: \{\n    name: "Acme",/)
  assert.equal(patchConfig(out, 'Acme'), out)
  assert.match(patchConfig('export default {\n}\n', 'X'), /pwa: \{/)
  assert.equal(patchConfig('module.exports = {}', 'X'), null)
})

test('patchLayout puts the prompt after the page slot', () => {
  const layout = 'layout Main\n\nimport Nav from "./components/Nav"\n\ntemplate\n<div>\n    <main data-tylix-slot="true"></main>\n</div>\n'
  const out = patchLayout(layout)
  assert.match(out, /import Nav from "\.\/components\/Nav"\nimport PwaPrompt from "\.\/components\/PwaPrompt"/)
  assert.match(out, /<main data-tylix-slot="true"><\/main>\n    <PwaPrompt \/>/)
  assert.equal(patchLayout(out), out)
})

async function app(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-pwa-'))
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), content)
  }
  return dir
}

test('make:pwa on a native app: icons, offline page, config, capability and prompt', async () => {
  const dir = await app({
    'package.json': JSON.stringify({ name: 'acme-shop', dependencies: {} }),
    'tylix.config.ts': 'export default defineConfig({\n});\n',
    'app/pages/_layout.tyx': 'layout L\n\nimport A from "./components/A"\n\ntemplate\n<main data-tylix-slot="true"></main>\n',
  })
  try {
    const { written } = await makePwa({ baseDir: dir, quiet: true })
    for (const f of ['public/pwa-192.png', 'public/offline.html', 'app/capabilities/Pwa.tyx', 'app/pages/components/PwaPrompt.tyx']) assert.ok(written.includes(f), f)
    assert.match(await fs.readFile(path.join(dir, 'tylix.config.ts'), 'utf-8'), /name: "Acme Shop"/)
    assert.match(await fs.readFile(path.join(dir, 'public/offline.html'), 'utf-8'), /Acme Shop can’t reach/)
    const png = await fs.readFile(path.join(dir, 'public/pwa-512.png'))
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.deepEqual((await makePwa({ baseDir: dir, quiet: true })).written, [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('make:pwa on a React app writes the prompt component', async () => {
  const dir = await app({ 'package.json': JSON.stringify({ name: 'r', dependencies: { '@tylix/react': '^2.0.0' } }), 'tsconfig.json': '{}' })
  try {
    const { written, notes } = await makePwa({ baseDir: dir, quiet: true })
    assert.ok(written.includes('app/views/components/PwaPrompt.tsx'))
    assert.match(notes.join('\n'), /render <PwaPrompt \/>/)
    assert.match(await fs.readFile(path.join(dir, 'app/views/components/PwaPrompt.tsx'), 'utf-8'), /usePwa\(\)/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('createPwa: production serves a real worker with a precache; dev serves one that removes itself', async () => {
  const dir = await app({
    'public/pwa-192.png': 'x',
    'public/pwa-512.png': 'x',
    'public/offline.html': '<p>off</p>',
    'public/styles.css': 'a{}',
    'dist/client/assets/index-abc.js': 'console.log(1)',
    'dist/client/assets/index-abc.js.map': '{}',
  })
  const serve = async (pwa, url) => {
    const routes = new Map()
    pwa.routes({ get: (p, h) => routes.set(p, h) })
    const res = { headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
    await routes.get(url)({}, res)
    return res
  }
  try {
    assert.equal(await createPwa(dir, {}, { production: true }), null)
    const prod = await createPwa(dir, { app: { name: 'Acme' }, pwa: true }, { production: true })
    assert.deepEqual(prod.options.icons.map((i) => i.src), ['/pwa-192.png', '/pwa-512.png'])
    assert.ok(prod.precache.includes('/styles.css'))
    assert.ok(prod.precache.includes('/assets/index-abc.js'))
    assert.ok(!prod.precache.some((p) => p.endsWith('.map')))
    const sw = await serve(prod, '/sw.js')
    assert.match(sw.headers['Cache-Control'], /no-cache/)
    assert.match(sw.body, /"offline": "\/offline.html"/)
    assert.match(prod.head, /"register":true/)
    const manifest = JSON.parse((await serve(prod, '/manifest.webmanifest')).body)
    assert.equal(manifest.name, 'Acme')

    const dev = await createPwa(dir, { pwa: { name: 'Acme' } }, { production: false })
    assert.match((await serve(dev, '/sw.js')).body, /unregister/)
    assert.match(dev.head, /"register":false/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
