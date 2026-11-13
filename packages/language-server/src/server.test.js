// Drives the real binary over stdio, the way an editor does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// TYLIX_LS_BIN runs the same test against a bundled server
// (editors/vscode/dist/server.cjs).
const BIN = process.env.TYLIX_LS_BIN ?? fileURLToPath(new URL('./bin.js', import.meta.url))

function startClient() {
  const child = spawn(process.execPath, [BIN, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let buffer = Buffer.alloc(0)
  let nextId = 1
  const pending = new Map()
  const notifications = []
  const waiters = []

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.slice(0, headerEnd).toString())[1])
      if (buffer.length < headerEnd + 4 + length) return
      const msg = JSON.parse(buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString())
      buffer = buffer.slice(headerEnd + 4 + length)
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      } else if (msg.method) {
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: null })
        notifications.push(msg)
        for (const w of [...waiters]) w()
      }
    }
  })

  function send(msg) {
    const body = Buffer.from(JSON.stringify(msg))
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
  }

  return {
    request(method, params) {
      const id = nextId++
      send({ jsonrpc: '2.0', id, method, params })
      return new Promise((resolve) => pending.set(id, (m) => resolve(m.result)))
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params })
    },
    // Resolves with the first notification matching `pred`, waiting
    // for one to arrive if needed.
    waitFor(pred, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for notification')), timeout)
        const check = () => {
          const i = notifications.findIndex(pred)
          if (i > -1) {
            clearTimeout(timer)
            waiters.splice(waiters.indexOf(check), 1)
            resolve(notifications.splice(i, 1)[0])
          }
        }
        waiters.push(check)
        check()
      })
    },
    async close() {
      await this.request('shutdown')
      this.notify('exit')
      await new Promise((r) => child.on('exit', r))
    },
  }
}

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-ls-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

const diagnosticsFor = (uri) => (n) =>
  n.method === 'textDocument/publishDiagnostics' && n.params.uri === uri

test('language server: diagnostics, typecheck, completion, hover, definition, symbols', async () => {
  const dir = makeProject({
    'package.json': '{"type":"module"}',
    'tsconfig.json': '{}',
    'tylix.config.ts': 'export default { compiler: { not: "loose" } }\n',
    'app/capabilities/Auth.tyx': 'capability Auth\n\nstate\n  user: null\n\naction\n  logout() {\n    this.user = null\n  }\n',
  })
  const file = path.join(dir, 'app', 'pages', 'Index.tyx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const uri = pathToFileURL(file).href
  const client = startClient()
  try {
    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(dir).href,
      capabilities: {},
      initializationOptions: { trusted: false },
    })
    assert.equal(init.capabilities.hoverProvider, true)
    client.notify('initialized', {})

    // 1. syntax error, positioned
    const broken = 'page Index\n\nstate\n  count(number): 0\n\ntemplate\n  <p>{{ count + }}</p>\n'
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'tyx', version: 1, text: broken } })
    let diag = await client.waitFor(diagnosticsFor(uri))
    assert.equal(diag.params.diagnostics.length, 1)
    assert.deepEqual(diag.params.diagnostics[0].range.start, { line: 6, character: 15 })
    assert.equal(diag.params.diagnostics[0].code, 'syntax')

    // 2. fixed -> clean, then a type error arrives from the typecheck pass
    const typed = 'page Index\n\nstate\n  count(number): 0\n  items: []\n\ntemplate\n  <p>{{ count.toUpperCase() }} {{ not items has 1 }}</p>\n'
    client.notify('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: typed }],
    })
    diag = await client.waitFor((n) => diagnosticsFor(uri)(n) && n.params.version === 2 && n.params.diagnostics.length > 0)
    assert.equal(diag.params.diagnostics[0].code, 'typecheck')
    assert.equal(diag.params.diagnostics[0].range.start.line, 7)
    assert.match(diag.params.diagnostics[0].message, /toUpperCase/)

    // 3. completion inside {{ }}, including the project's capability
    const items = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: { line: 7, character: 8 },
    })
    const labels = items.map((i) => i.label)
    assert.ok(labels.includes('count') && labels.includes('items') && labels.includes('Auth'))

    // 4. hover on `count` in the template
    const h = await client.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 7, character: 9 },
    })
    assert.match(h.contents.value, /\(state\) count: number/)

    // 5. definition of `count` -> its state line in the same file
    const def = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: 7, character: 9 },
    })
    assert.equal(def.uri, uri)
    assert.deepEqual(def.range.start, { line: 3, character: 2 })

    // 6. outline
    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } })
    assert.deepEqual(symbols.map((s) => s.name), ['count', 'items'])

    // 7. a generator template that happens to be .tyx: no diagnostics
    const gen = pathToFileURL(path.join(dir, 'gen.tyx')).href
    client.notify('textDocument/didOpen', {
      textDocument: { uri: gen, languageId: 'tyx', version: 1, text: '/** Generated */\nimport { {{Model}} } from "x"\n' },
    })
    diag = await client.waitFor(diagnosticsFor(gen))
    assert.deepEqual(diag.params.diagnostics, [])
  } finally {
    await client.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
