// The frontend matrix: every starter, scaffolded fresh from this checkout,
// must pass the same checks in development and in production.
//
//   node e2e/frontends.mjs                         all frontends
//   node e2e/frontends.mjs --only react,vue        some of them
//   node e2e/frontends.mjs --reuse                 keep apps from an earlier run (skips scaffolding)
//   node e2e/frontends.mjs --skip-production       dev checks only
//
// Per frontend (React, Vue, Svelte and Angular, each with SSR on, plus the
// native .tyx pages):
//   dev         parity.mjs --ssr   auth, routing, API, SSR, hydration
//               hot-reload.mjs     saved files reach the open tab
//               error-pages.mjs    error boundary, 404/400/500 pages
//   production  tylix build, then tylix start with two workers:
//               parity.mjs --ssr --existing (the account from the dev run)
//               error-pages.mjs --production
//
// Apps go in $TYLIX_E2E_DIR (default: <tmp>/tylix-e2e), linked to the
// packages in this checkout. Exits non-zero if any check failed.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep, waitFor } from './lib/browser.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = process.env.TYLIX_E2E_DIR ?? path.join(os.tmpdir(), 'tylix-e2e')
const BASE_PORT = Number(process.env.BASE_PORT ?? 4300)

const ALL = ['react', 'vue', 'svelte', 'angular', 'tylix']
const flag = (name) => process.argv.includes(name)
const onlyArg = process.argv.indexOf('--only')
const frontends = onlyArg > -1 ? process.argv[onlyArg + 1].split(',') : ALL
for (const f of frontends) {
  if (!ALL.includes(f)) {
    console.error(`Unknown frontend "${f}". Pick from: ${ALL.join(', ')}`)
    process.exit(2)
  }
}
const reuse = flag('--reuse')
const skipProduction = flag('--skip-production')

// Runs a command to completion, appending its output to `log`.
function run(cmd, args, { cwd, env, log }) {
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'a')
    fs.writeSync(out, `\n$ ${cmd} ${args.join(' ')}\n`)
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out] })
    child.on('exit', (code) => {
      fs.closeSync(out)
      resolve(code ?? 1)
    })
  })
}

// Runs one check script, printing its report as it comes.
function check(script, args, { log }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'e2e', script), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const collect = (chunk) => {
      output += chunk
      process.stdout.write(String(chunk).replace(/^/gm, '    '))
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('exit', (code) => {
      fs.appendFileSync(log, `\n# ${script} ${args.join(' ')}\n${output}`)
      resolve({ ok: code === 0, output })
    })
  })
}

// Starts a long-running tylix command (dev, start) and waits until it
// serves pages. stop() ends it the way Ctrl+C would.
async function serve(appDir, args, { port, env, log }) {
  const out = fs.openSync(log, 'a')
  const child = spawn(process.execPath, [path.join(appDir, 'node_modules', '@tylix', 'cli', 'src', 'index.js'), ...args], {
    cwd: appDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', out, out],
  })
  let exited = false
  child.on('exit', () => {
    exited = true
    fs.closeSync(out)
  })
  const stop = async () => {
    if (exited) return
    child.kill('SIGTERM')
    for (let i = 0; i < 50 && !exited; i++) await sleep(100)
    if (!exited) child.kill('SIGKILL')
  }
  try {
    await waitFor(
      async () => {
        if (exited) throw new Error('the server exited')
        const res = await fetch(`http://localhost:${port}/`, { headers: { Accept: 'text/html' } })
        return res.status < 500
      },
      { timeout: 120000, interval: 500, what: `tylix ${args[0]} on port ${port}` },
    )
  } catch (err) {
    await stop()
    throw err
  }
  return { stop }
}

async function scaffold(frontend, name, log) {
  const args = [
    path.join(ROOT, 'packages', 'create-tylix', 'src', 'index.js'),
    name,
    '--yes',
    '--frontend',
    frontend,
    '--language',
    'ts',
    '--database',
    'sqlite',
    '--auth',
    'yes',
    '--styling',
    'tailwind',
    '--template',
    'starter',
    '--no-git',
  ]
  const code = await run(process.execPath, args, { cwd: WORK, env: { TYLIX_LOCAL: '1' }, log })
  if (code !== 0) throw new Error(`scaffolding failed (see ${log})`)
}

const summary = []

async function runFrontend(frontend, index) {
  const name = `e2e-${frontend}`
  const appDir = path.join(WORK, name)
  const log = path.join(WORK, `${name}.log`)
  const devPort = BASE_PORT + index * 2
  const prodPort = devPort + 1
  const base = (port) => `http://localhost:${port}`
  const hosted = frontend !== 'tylix'
  const failures = []
  const record = (label, ok) => {
    if (!ok) failures.push(label)
  }

  console.log(`\n==> ${frontend}${hosted ? ' (SSR)' : ' (native pages)'}  ${appDir}`)
  fs.writeFileSync(log, '')

  if (!reuse || !fs.existsSync(path.join(appDir, 'node_modules'))) {
    fs.rmSync(appDir, { recursive: true, force: true })
    console.log('  scaffolding and installing...')
    await scaffold(frontend, name, log)
  }

  // Dev ------------------------------------------------------------------
  let account = null
  console.log(`  tylix dev on :${devPort}`)
  const dev = await serve(appDir, ['dev', '--port', String(devPort)], { port: devPort, env: { APP_DEBUG: 'true' }, log })
  try {
    if (hosted) {
      const parity = await check('parity.mjs', [base(devPort), '--ssr'], { log })
      record('dev parity', parity.ok)
      account = /account: (\S+)/.exec(parity.output)?.[1] ?? null
    }
    record('dev hot reload', (await check('hot-reload.mjs', [appDir, base(devPort)], { log })).ok)
    // --keep: the throwing page stays, so the production build has it.
    const keep = hosted && !skipProduction ? ['--keep'] : []
    record('dev error pages', (await check('error-pages.mjs', [appDir, base(devPort), ...keep], { log })).ok)
  } finally {
    await dev.stop()
  }

  // Production -------------------------------------------------------------
  if (!skipProduction) {
    console.log('  tylix build')
    const built = (await run(process.execPath, [path.join(appDir, 'node_modules', '@tylix', 'cli', 'src', 'index.js'), 'build'], { cwd: appDir, log })) === 0
    record('production build', built)
    if (!built) console.log(`    ✘ build failed (see ${log})`)
    else {
      console.log(`  tylix start --workers 2 on :${prodPort}`)
      const env = { NODE_ENV: 'production', AUTH_SECRET: `e2e-${Date.now()}-${Math.random()}`, APP_DEBUG: 'false' }
      let prod
      try {
        prod = await serve(appDir, ['start', '--port', String(prodPort), '--workers', '2'], { port: prodPort, env, log })
      } catch (err) {
        console.log(`    ✘ ${err.message} (see ${log})`)
        record('production start', false)
      }
      if (prod) {
        try {
          if (hosted) {
            if (account) record('production parity', (await check('parity.mjs', [base(prodPort), '--ssr', '--existing', account], { log })).ok)
            else record('production parity (no account from the dev run)', false)
          }
          record('production error pages', (await check('error-pages.mjs', [appDir, base(prodPort), '--production'], { log })).ok)
        } finally {
          await prod.stop()
        }
      }
    }
  }

  summary.push({ frontend, failures, log })
}

fs.mkdirSync(WORK, { recursive: true })
console.log(`Frontend matrix: ${frontends.join(', ')}  (apps in ${WORK})`)
for (const [i, frontend] of frontends.entries()) {
  try {
    await runFrontend(frontend, ALL.indexOf(frontend) ?? i)
  } catch (err) {
    console.log(`    ✘ ${err.message}`)
    summary.push({ frontend, failures: [err.message], log: path.join(WORK, `e2e-${frontend}.log`) })
  }
}

console.log('\nSummary')
for (const { frontend, failures, log } of summary) {
  console.log(failures.length ? `  ✘ ${frontend}: ${failures.join(', ')} (log: ${log})` : `  ✔ ${frontend}`)
}
process.exitCode = summary.some((s) => s.failures.length) ? 1 : 0
