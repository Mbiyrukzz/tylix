// scripts/bump.mjs
// usage: node scripts/bump.mjs minor | patch | major | 0.6.0
import fs from 'node:fs'
import path from 'node:path'

const arg = process.argv[2]
if (!arg) throw new Error('usage: node scripts/bump.mjs minor|patch|major|x.y.z')

const pkgDir = 'packages'
const dirs = fs.readdirSync(pkgDir).filter(d => fs.existsSync(path.join(pkgDir, d, 'package.json')))
const read = d => JSON.parse(fs.readFileSync(path.join(pkgDir, d, 'package.json'), 'utf8'))

// Highest current version across all packages, so they all land on the same number
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }
const current = dirs.map(d => read(d).version.split('.').map(Number)).sort(cmp).pop()

let next
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg
else if (arg === 'major') next = `${current[0] + 1}.0.0`
else if (arg === 'minor') next = `${current[0]}.${current[1] + 1}.0`
else if (arg === 'patch') next = `${current[0]}.${current[1]}.${current[2] + 1}`
else throw new Error('bad argument')

console.log(`highest current: ${current.join('.')}  ->  ${next}\n`)

for (const d of dirs) {
  const file = path.join(pkgDir, d, 'package.json')
  const pkg = read(d)
  pkg.version = next
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dep of Object.keys(pkg[field] || {})) {
      const v = pkg[field][dep]
      // only touch real semver ranges, leave workspace:* / file: alone
      if (dep.startsWith('@tylix/') && /^[\^~]?\d/.test(v)) pkg[field][dep] = `^${next}`
    }
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`${pkg.name}  ${next}`)
}