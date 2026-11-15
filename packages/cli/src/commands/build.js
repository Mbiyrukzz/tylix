import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { detectLanguage, loadEnv, loadConfig, exists as pathExists, resolveViewsDir } from '@tylix/shared'
import {
  NATIVE_DRIVER,
  buildFrontend,
  loadFrontendAdapter,
  resolveFrontendDriver,
} from '../frontend/frontendHost.js'
import { runCheck } from './check.js'

const execFileAsync = promisify(execFile)

const DEV_AUTH_SECRET = 'tylix-dev-secret-change-me'


// Returns true if the config check passed.
async function checkConfig(baseDir, language, isProduction) {
  const ext = language === 'typescript' ? 'ts' : 'js'
  console.log('\nChecking configuration...')

  let config
  try {
    config = await loadConfig(baseDir, language)
  } catch (err) {
    console.log(`✘ Could not load tylix.config.${ext}: ${err.message}`)
    return false
  }

  const secret = config?.auth?.secret
  if (!secret || secret === DEV_AUTH_SECRET) {
    const message = !secret
      ? 'auth.secret is empty -- set AUTH_SECRET in the environment.'
      : 'auth.secret is the public default dev secret -- set AUTH_SECRET.'
    if (isProduction) {
      console.log(`✘ ${message}`)
      return false
    }
    console.log(`⚠ ${message} (this fails the build when NODE_ENV=production)`)
    return true
  }

  console.log('✔ Configuration loaded.')
  return true
}

// Returns true if every .tyx file under app/ parsed (and typechecked).
async function checkTyxFiles(baseDir, typecheck) {
  const { formatDiagnostic } = await import('@tylix/compiler')
  const result = await runCheck({ baseDir, typecheck })
  const what = typecheck ? 'Typechecking' : 'Checking'
  console.log(`\n${what} ${result.checked} .tyx file(s)...`)

  const failed = result.files.filter((f) => f.diagnostics.length > 0)
  for (const f of failed) {
    const rel = path.relative(baseDir, f.file)
    console.log(`\n✘ ${rel}`)
    for (const d of f.diagnostics) {
      console.log(
        formatDiagnostic(f.source, d, rel)
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
      )
    }
  }

  if (failed.length === 0) {
    console.log(typecheck ? '✔ No type errors found.' : '✔ No syntax errors found.')
    return true
  }
  console.log(`\n${failed.length} of ${result.checked} .tyx file(s) failed.`)
  return false
}

// Returns true if CSS built (or there was nothing to build).
async function buildCss(baseDir) {
  const binPath = path.join(baseDir, 'node_modules', '.bin', 'tailwindcss')
  const inputPath = path.join(baseDir, 'app', 'tailwind-input.css')
  const outputPath = path.join(baseDir, 'public', 'tailwind.css')

  if (!(await pathExists(binPath)) || !(await pathExists(inputPath))) {
    return true
  }

  console.log('\nBuilding production CSS...')
  try {
    await execFileAsync(binPath, [
      '-i',
      inputPath,
      '-o',
      outputPath,
      '--minify',
    ])
    console.log('✔ Tailwind CSS built and minified.')
    return true
  } catch (err) {
    console.log(`✘ Tailwind build failed: ${err.message}`)
    return false
  }
}

// Typechecks a hosted frontend against app/views/tsconfig.json with the
// checker its adapter names (tsc for React, svelte-check for Svelte), run
// from the project's own node_modules. Skipped when the tsconfig or the
// checker is missing, e.g. in a JavaScript project.
async function typecheckFrontend(baseDir, driver) {
  const { adapter } = await loadFrontendAdapter(baseDir, driver)
  const checker = adapter.typecheck ?? {
    bin: 'tsc',
    args: (tsconfig) => ['--noEmit', '-p', tsconfig],
  }
  const binPath = path.join(baseDir, 'node_modules', '.bin', checker.bin)
  const tsconfig = path.join(resolveViewsDir(baseDir), 'tsconfig.json')
  if (!(await pathExists(binPath)) || !(await pathExists(tsconfig))) return true

  console.log(`\nTypechecking the frontend (${checker.bin})...`)
  try {
    await execFileAsync(binPath, checker.args(tsconfig), { cwd: baseDir })
    console.log('✔ No type errors found.')
    return true
  } catch (err) {
    console.log(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message)
    console.log('✘ The frontend has type errors.')
    return false
  }
}

// Bundles a hosted frontend into dist/client with Vite.
async function bundleFrontend(baseDir, driver, config) {
  console.log('\nBuilding the frontend...')
  try {
    const { outDir, label } = await buildFrontend(baseDir, { driver, config })
    console.log(`✔ ${label} app built to ${path.relative(baseDir, outDir)}.`)
    return true
  } catch (err) {
    console.log(`✘ Frontend build failed: ${err.message}`)
    return false
  }
}

// `tylix build` is a pre-flight gate for production, not a bundler --
// pages are rendered per request against a live database/auth/feature
// backend, so there's no static HTML to emit. It checks the config,
// typechecks every page up front, and produces a minified CSS bundle.
// Exits non-zero on any failure so CI and deploy tooling can stop a
// bad release.
export async function build() {
  const baseDir = process.cwd()
  const isProduction = process.env.NODE_ENV === 'production'

  await loadEnv(baseDir)
  const language = await detectLanguage(baseDir)

  console.log('Tylix Build')
  console.log('─'.repeat(28))

  const results = []
  results.push(await checkConfig(baseDir, language, isProduction))

  let driver = NATIVE_DRIVER
  let config = null
  try {
    config = await loadConfig(baseDir, language)
    driver = resolveFrontendDriver(config)
  } catch (err) {
    // A config that doesn't load already failed checkConfig above.
    if (config) {
      console.log(`✘ ${err.message}`)
      results.push(false)
    }
  }

  if (driver === NATIVE_DRIVER) {
    // Every .tyx file is parsed (so a syntax error fails the build in
    // JavaScript projects too); TypeScript projects are typechecked.
    results.push(await checkTyxFiles(baseDir, language === 'typescript'))
    results.push(await buildCss(baseDir))
  } else {
    if (language === 'typescript') {
      results.push(await typecheckFrontend(baseDir, driver))
    }
    // Tailwind runs inside the Vite build for hosted frontends.
    if (!results.includes(false)) {
      results.push(await bundleFrontend(baseDir, driver, config))
    }
  }

  console.log()
  if (results.includes(false)) {
    console.log('Build failed — fix the errors above before deploying.')
    process.exitCode = 1
  } else {
    console.log('Build passed. Ready to deploy.')
  }
}