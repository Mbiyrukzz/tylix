// Benchmarks each server in its own process with autocannon.
//   node run.mjs [--duration 5] [--connections 50] [--only tylix,fastify] [--json out.json]
// Absolute numbers depend on the machine; compare frameworks within one run.
import { fork } from 'node:child_process'
import fs from 'node:fs'
import autocannon from 'autocannon'

const args = process.argv.slice(2)
// Tylix runs without its access log, like the others (Fastify logs nothing
// by default); TYLIX_ACCESS_LOG=true measures it with the log.
process.env.TYLIX_ACCESS_LOG ??= 'false'
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const duration = Number(flag('duration', 5))
const connections = Number(flag('connections', 50))
const only = flag('only', '')?.split(',').filter(Boolean)
const SERVERS = ['node', 'tylix', 'tylix-workers', 'fastify', 'hono', 'express'].filter((s) => !only?.length || only.includes(s))
const SCENARIOS = [
  { name: 'GET /hello (JSON)', path: '/hello' },
  { name: 'GET /users/:id (after 50 routes)', path: '/users/42' },
  { name: 'POST /echo (JSON body)', path: '/echo', method: 'POST', body: JSON.stringify({ name: 'Ada', tags: ['a', 'b'], n: 42 }), headers: { 'content-type': 'application/json' } },
]

function start(name, port) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL(`./servers/${name}.mjs`, import.meta.url), { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
    child.once('message', () => resolve(child))
    child.once('exit', (code) => reject(new Error(`${name} exited with ${code}`)))
  })
}

// Stop every server this run started, even when the run fails.
const children = new Set()
process.on('exit', () => children.forEach((child) => child.kill()))

const results = []
let port = 4100 + Math.floor(Math.random() * 500)
for (const server of SERVERS) {
  const child = await start(server, ++port)
  children.add(child)
  for (const scenario of SCENARIOS) {
    const options = { url: `http://127.0.0.1:${port}${scenario.path}`, connections, method: scenario.method ?? 'GET', ...(scenario.body ? { body: scenario.body, headers: scenario.headers } : {}) }
    await autocannon({ ...options, duration: 1 }) // warm up the JIT
    const r = await autocannon({ ...options, duration })
    results.push({ server, scenario: scenario.name, rps: Math.round(r.requests.average), p99: r.latency.p99, errors: r.errors + r.non2xx })
    process.stdout.write('.')
  }
  child.kill()
}
console.log('\n')
for (const scenario of SCENARIOS) {
  console.log(scenario.name)
  const rows = results.filter((r) => r.scenario === scenario.name).sort((a, b) => b.rps - a.rps)
  for (const r of rows) console.log(`  ${r.server.padEnd(8)} ${String(r.rps).padStart(7)} req/s   p99 ${String(r.p99).padStart(3)} ms${r.errors ? `   ${r.errors} errors` : ''}`)
}
const out = flag('json', null)
if (out) fs.writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), node: process.version, duration, connections, results }, null, 2))
