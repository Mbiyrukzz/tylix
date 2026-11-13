// Copies the extension into dist/ (load it unpacked from there) and,
// when the `zip` command exists, packs dist/ into tylix-devtools.zip
// for the Chrome Web Store / Firefox Add-ons.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

fs.rmSync(DIST, { recursive: true, force: true })
fs.cpSync(path.join(ROOT, 'src'), DIST, { recursive: true })
fs.cpSync(path.join(ROOT, 'icons'), path.join(DIST, 'icons'), { recursive: true })

// Keep the manifest version in step with the package.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const manifestPath = path.join(DIST, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
manifest.version = pkg.version
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`built ${path.relative(process.cwd(), DIST)}/ (load unpacked from here)`)
try {
  const zip = path.join(ROOT, 'tylix-devtools.zip')
  fs.rmSync(zip, { force: true })
  execFileSync('zip', ['-qr', zip, '.'], { cwd: DIST })
  console.log(`packed ${path.relative(process.cwd(), zip)}`)
} catch {
  console.log('(no `zip` command: skipped the store package)')
}
