import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { getPackageManager } from '../utils/packageManager.js'
import {
  createNpmTracker,
  createPnpmTracker,
  isTylixPackage,
  missingVersion,
} from '../utils/installProgress.js'

// Waits before retrying when one of our own packages "doesn't exist" yet.
// npm says a fresh publish "may take a few minutes to become available".
const RETRY_DELAYS_S = [15, 30, 45]

// Output worth showing when the install fails: everything except the
// chatty log levels we only turned on to drive the progress bar.
const NOISE = /^npm (silly|verbose|timing|http|info) /
const MAX_KEPT_LINES = 400

function runInstall(pm, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(pm, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // npm and pnpm are .cmd shims on Windows, which need a shell.
      shell: process.platform === 'win32',
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    })

    const kept = []
    const handle = (line) => {
      onLine(line)
      if (!NOISE.test(line)) {
        kept.push(line)
        if (kept.length > MAX_KEPT_LINES) kept.shift()
      }
    }
    readline.createInterface({ input: child.stdout }).on('line', handle)
    readline.createInterface({ input: child.stderr }).on('line', handle)

    child.on('error', reject)
    child.on('close', (code, signal) => {
      const output = kept.join('\n')
      if (code === 0) return resolve(output)
      const err = new Error(
        `Command failed: ${pm} install` +
          (signal ? ` (killed by ${signal})` : '') +
          (output ? `\n${output}` : ''),
      )
      err.output = output
      reject(err)
    })
  })
}

// `onProgress(fraction, detail)` is called as the install moves along;
// fraction is an estimate between 0 and 1.
export async function installPackages(config, { onProgress = () => {} } = {}) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const pm = getPackageManager(config)

  for (let attempt = 0; ; attempt++) {
    const tracker = pm === 'pnpm' ? createPnpmTracker() : createNpmTracker()
    const args =
      pm === 'pnpm'
        ? ['install', '--reporter=append-only']
        : ['install', '--loglevel', 'silly', '--no-audit', '--no-fund']
    // After a "no matching version", don't trust cached registry data.
    if (attempt > 0 && pm === 'npm') args.push('--prefer-online')

    onProgress(0, attempt ? 'Retrying install' : 'Starting install')
    try {
      await runInstall(pm, args, targetDir, (line) => {
        const state = tracker.feed(line)
        if (state) onProgress(state.fraction, state.detail)
      })
      onProgress(1, 'Packages installed')
      return
    } catch (err) {
      const output = err.output ?? ''

      // pnpm 10+ refuses to run dependency install scripts that are not
      // allowed in pnpm-workspace.yaml. Say what to do instead of showing
      // pnpm's raw output.
      if (output.includes('ERR_PNPM_IGNORED_BUILDS')) {
        throw new Error(
          `pnpm blocked a dependency's install script (ERR_PNPM_IGNORED_BUILDS).\n` +
            `Run "cd ${config.projectName} && pnpm approve-builds", then "pnpm install".\n\n` +
            output,
        )
      }

      const missing = missingVersion(output)
      if (missing && isTylixPackage(missing)) {
        if (attempt < RETRY_DELAYS_S.length) {
          for (let s = RETRY_DELAYS_S[attempt]; s > 0; s--) {
            onProgress(
              0,
              `${missing} isn't on the npm registry yet · retrying in ${s}s (${attempt + 1}/${RETRY_DELAYS_S.length})`,
            )
            await sleep(1000)
          }
          continue
        }
        throw new Error(
          `${missing} is still not available on the npm registry.\n` +
            `If it was just published, wait a few minutes and run create-tylix again.\n\n` +
            output,
        )
      }

      throw err
    }
  }
}
