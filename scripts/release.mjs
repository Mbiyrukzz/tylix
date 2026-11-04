import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const VERSION = process.argv[2]
const MODE = process.argv[3] // bump | dry | publish
const OTP = process.argv[4] || process.env.NPM_OTP

if (!VERSION || !/^\d+\.\d+\.\d+$/.test(VERSION) || !['bump', 'dry', 'publish'].includes(MODE)) {
  console.error('usage: node scripts/release.mjs <x.y.z> <bump|dry|publish> [otp]')
  process.exit(1)
}

const ROOT = 'packages'
const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const ORDER_KEYS = ['dependencies', 'optionalDependencies']

// ---------------------------------------------------------------- packages

const pkgs = {}
for (const dir of fs.readdirSync(ROOT)) {
  const file = path.join(ROOT, dir, 'package.json')
  if (!fs.existsSync(file)) continue
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (json.private) continue
  pkgs[json.name] = { dir: path.join(ROOT, dir), file, json }
}
const names = new Set(Object.keys(pkgs))

// ------------------------------------------- create-tylix PUBLISHED_VERSIONS

// create-tylix pins the versions that freshly scaffolded apps install. They
// have to move with every release, so bump rewrites them and dry/publish
// refuse to run while they are stale.
const PIN_BLOCK = /const PUBLISHED_VERSIONS = \{[\s\S]*?\n\}/
const PIN_ENTRY = /(['"])([^'"]+)\1(\s*:\s*)(['"])\^?(\d+\.\d+\.\d+)\4/g

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') yield* walk(p)
    } else if (/\.(js|mjs|ts)$/.test(e.name)) {
      yield p
    }
  }
}

function findPinFiles() {
  const out = []
  const src = path.join(ROOT, 'create-tylix', 'src')
  if (!fs.existsSync(src)) return out
  for (const file of walk(src)) {
    const text = fs.readFileSync(file, 'utf8')
    const m = text.match(PIN_BLOCK)
    if (m) out.push({ file, text, block: m[0] })
  }
  return out
}

function rewritePins() {
  for (const { file, text, block } of findPinFiles()) {
    const updated = block.replace(PIN_ENTRY, (all, q, name, colon) =>
      names.has(name) ? `${q}${name}${q}${colon}'^${VERSION}'` : all,
    )
    fs.writeFileSync(file, text.replace(block, updated))
    console.log(`updated PUBLISHED_VERSIONS in ${file}`)
  }
}

// ------------------------------------------------------------------- bump

if (MODE === 'bump') {
  for (const p of Object.values(pkgs)) {
    p.json.version = VERSION
    for (const k of DEP_KEYS) {
      for (const n in p.json[k] || {}) {
        if (names.has(n)) p.json[k][n] = `^${VERSION}`
      }
    }
    fs.writeFileSync(p.file, JSON.stringify(p.json, null, 2) + '\n')
  }
  rewritePins()
  console.log(`bumped ${names.size} packages to ${VERSION}`)
  process.exit(0)
}

// ------------------------------------------------- pre-flight (dry/publish)

const problems = []
for (const [n, p] of Object.entries(pkgs)) {
  if (p.json.version !== VERSION) {
    problems.push(`${n}: version is ${p.json.version}, expected ${VERSION}`)
  }
  for (const k of DEP_KEYS) {
    for (const d in p.json[k] || {}) {
      if (names.has(d) && p.json[k][d] !== `^${VERSION}`) {
        problems.push(`${n}: ${k}.${d} is ${p.json[k][d]}, expected ^${VERSION}`)
      }
    }
  }
}
for (const { file, block } of findPinFiles()) {
  for (const m of block.matchAll(PIN_ENTRY)) {
    if (names.has(m[2]) && m[5] !== VERSION) {
      problems.push(`${file}: pin for ${m[2]} is ^${m[5]}, expected ^${VERSION}`)
    }
  }
}
if (problems.length) {
  console.error('Not ready to release. Run the bump step first:\n  ' + problems.join('\n  '))
  process.exit(1)
}

// ------------------------------------------------------------ publish order

function internalDeps(json) {
  const out = new Set()
  for (const k of ORDER_KEYS) {
    for (const n in json[k] || {}) if (names.has(n)) out.add(n)
  }
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

// `npm view name@x.y.z version` can exit 0 with empty output when the
// package exists but that version does not, so check the output, not just
// the exit code.
function published(name) {
  try {
    const out = execSync(`npm view ${name}@${VERSION} version`, { stdio: 'pipe' })
    return out.toString().trim() === VERSION
  } catch {
    return false
  }
}

for (const n of order) {
  if (published(n)) {
    console.log(`skip ${n}@${VERSION} (already published)`)
    continue
  }
  const base = `npm publish --access public${MODE === 'dry' ? ' --dry-run' : ''}`
  console.log(`\n> ${n}: ${base}`)
  try {
    execSync(OTP ? `${base} --otp=${OTP}` : base, { cwd: pkgs[n].dir, stdio: 'inherit' })
  } catch {
    console.error(
      `\nFailed on ${n}. If this was an OTP error, run the same command again with a ` +
        `fresh code: packages already published are skipped.`,
    )
    process.exit(1)
  }
}

console.log(`\ndone: ${MODE === 'dry' ? 'dry run of ' : ''}${order.length} packages at ${VERSION}`)