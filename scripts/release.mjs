import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const VERSION = process.argv[2]
const MODE = process.argv[3] // bump | dry | publish
const OTP = process.argv[4]
if (!VERSION || !['bump', 'dry', 'publish'].includes(MODE)) {
  console.error('usage: node scripts/release.mjs <version> <bump|dry|publish> [otp]')
  process.exit(1)
}

const ROOT = 'packages'
const pkgs = {}
for (const dir of fs.readdirSync(ROOT)) {
  const file = path.join(ROOT, dir, 'package.json')
  if (!fs.existsSync(file)) continue
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (json.private) continue
  pkgs[json.name] = { dir: path.join(ROOT, dir), file, json }
}
const names = new Set(Object.keys(pkgs))
const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const ORDER_KEYS = ['dependencies', 'optionalDependencies']

if (MODE === 'bump') {
  for (const p of Object.values(pkgs)) {
    p.json.version = VERSION
    for (const k of DEP_KEYS)
      for (const n in p.json[k] || {})
        if (names.has(n)) p.json[k][n] = `^${VERSION}`
    fs.writeFileSync(p.file, JSON.stringify(p.json, null, 2) + '\n')
  }
  console.log(`bumped ${names.size} packages to ${VERSION}`)
  process.exit(0)
}

function internalDeps(json) {
  const out = new Set()
  for (const k of ORDER_KEYS)
    for (const n in json[k] || {}) if (names.has(n)) out.add(n)
  return out
}

const order = []
const seen = new Set()
function visit(n, stack = []) {
  if (seen.has(n)) return
  if (stack.includes(n)) {
    console.warn('WARNING: circular dependency: ' + [...stack, n].join(' -> ') + ' (continuing)')
    return
  }
  for (const d of internalDeps(pkgs[n].json)) visit(d, [...stack, n])
  seen.add(n)
  order.push(n)
}
names.forEach((n) => visit(n))
console.log('publish order:\n  ' + order.join('\n  '))

function published(name) {
  try {
    execSync(`npm view ${name}@${VERSION} version`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

for (const n of order) {
  if (published(n)) {
    console.log(`skip ${n}@${VERSION} (already published)`)
    continue
  }
  const cmd = `npm publish --access public${MODE === 'dry' ? ' --dry-run' : ''}${OTP ? ` --otp=${OTP}` : ''}`
  console.log(`\n> ${n}: ${cmd}`)
  execSync(cmd, { cwd: pkgs[n].dir, stdio: 'inherit' })
}
