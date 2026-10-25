import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..', 'packages')
const dry = process.argv.includes('--dry-run')
const otp = process.argv.find((a) => a.startsWith('--otp='))

const pkgs = new Map()
for (const dir of fs.readdirSync(root)) {
  const file = path.join(root, dir, 'package.json')
  if (!fs.existsSync(file)) continue
  const json = JSON.parse(fs.readFileSync(file, 'utf-8'))
  if (json.private) continue
  pkgs.set(json.name, { dir: path.join(root, dir), json })
}

// Dependencies first.
const order = []
const seen = new Set()
function visit(name, stack = []) {
  if (seen.has(name)) return
  if (stack.includes(name)) {
    console.warn(`warning: dependency cycle ${[...stack, name].join(' -> ')}`)
    return
  }
  const { json } = pkgs.get(name)
  const deps = {
    ...json.dependencies,
    ...json.peerDependencies,
    ...json.optionalDependencies,
  }
  for (const dep of Object.keys(deps)) {
    if (pkgs.has(dep)) visit(dep, [...stack, name])
  }
  seen.add(name)
  order.push(name)
}
for (const name of pkgs.keys()) visit(name)

console.log('Publish order:\n  ' + order.join('\n  ') + '\n')

for (const name of order) {
  const { dir, json } = pkgs.get(name)

  // Makes the script safe to re-run after a failure halfway through.
  let published = false
  try {
    execSync(`npm view ${name}@${json.version} version`, { stdio: 'pipe' })
    published = true
  } catch {}
  if (published) {
    console.log(`skip ${name}@${json.version} (already published)`)
    continue
  }

  const cmd = ['npm publish', '--access public', dry && '--dry-run', otp]
    .filter(Boolean)
    .join(' ')
  console.log(`\n> ${name}@${json.version}: ${cmd}`)
  execSync(cmd, { cwd: dir, stdio: 'inherit' })
}