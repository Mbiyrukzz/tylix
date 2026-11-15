import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { detectLanguage, exists, loadConfig, loadEnv } from '@tylix/shared'
import { BUILTIN_ADAPTERS } from '../deploy/adapters.js'
import { preparePlugins } from '../server/plugins.js'

function detectPackageManager(baseDir) {
  if (existsSync(path.join(baseDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(baseDir, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(baseDir, 'bun.lockb')) || existsSync(path.join(baseDir, 'bun.lock'))) return 'bun'
  return 'npm'
}

// Built-in adapters plus those plugins add.
export async function deployAdapters(baseDir, config) {
  const adapters = new Map(Object.entries(BUILTIN_ADAPTERS))
  const host = await preparePlugins(baseDir, config)
  for (const [name, { plugin, value }] of host.collect('deployAdapters')) {
    if (adapters.has(name)) throw new Error(`Plugin "${plugin}" defines deploy adapter "${name}", which is built in.`)
    adapters.set(name, value)
  }
  return adapters
}

function listAdapters(adapters) {
  const server = [...adapters.values()].filter((a) => !a.static)
  const statics = [...adapters.values()].filter((a) => a.static)
  console.log('Server (tylix start):')
  for (const a of server) console.log(`  ${a.name.padEnd(18)} ${a.label}`)
  console.log('\nStatic (tylix export):')
  for (const a of statics) console.log(`  ${a.name.padEnd(18)} ${a.label}`)
  console.log('\nUsage: tylix deploy:init <adapter> [--force]')
}

// tylix deploy:init <adapter> [--force]
export async function deployInit(name, { force = false } = {}) {
  const baseDir = process.cwd()
  await loadEnv(baseDir)
  const language = await detectLanguage(baseDir)
  const config = await loadConfig(baseDir, language)
  const adapters = await deployAdapters(baseDir, config)

  if (!name) return listAdapters(adapters)
  const adapter = adapters.get(name)
  if (!adapter) {
    console.error(`Unknown deploy adapter "${name}".\n`)
    listAdapters(adapters)
    process.exitCode = 1
    return
  }

  const pkg = JSON.parse(await fs.readFile(path.join(baseDir, 'package.json'), 'utf8').catch(() => '{}'))
  const context = {
    baseDir,
    config,
    language,
    packageManager: detectPackageManager(baseDir),
    appName: String(pkg.name ?? path.basename(baseDir)).replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
    static: Boolean(adapter.static),
  }
  const files = await adapter.files(context)

  const existing = []
  for (const file of Object.keys(files)) if (await exists(path.join(baseDir, file))) existing.push(file)
  if (existing.length && !force) {
    console.error(`✘ These files exist already: ${existing.join(', ')}. Pass --force to replace them.`)
    process.exitCode = 1
    return
  }

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(baseDir, file)
    if (!target.startsWith(baseDir + path.sep)) throw new Error(`Adapter "${name}" tried to write outside the project: ${file}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
    console.log(`✔ ${file}`)
  }

  const steps = adapter.nextSteps?.(context) ?? []
  if (steps.length) {
    console.log(`\nNext, for ${adapter.label}:`)
    for (const step of steps) console.log(`  ${step}`)
  }
  if (!adapter.static) console.log('\nIn production set AUTH_SECRET (and APP_URL); "tylix doctor" checks the rest.')
}
