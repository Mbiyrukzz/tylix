import fs from 'node:fs/promises'
import path from 'node:path'

export async function makeIcon(name, pathData) {
  const baseDir = process.cwd()
  const iconsDir = path.join(baseDir, 'app', 'pages', 'components')
  await fs.mkdir(iconsDir, { recursive: true })

  const filePath = path.join(iconsDir, `${name}.tyx`)
  const content = `component ${name}\n\ntemplate\n  <svg class="w-full h-full" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">\n    <path stroke-linecap="round" stroke-linejoin="round" d="${pathData}" />\n  </svg>\n`

  await fs.writeFile(filePath, content)
  console.log(`✔ Icon created: ${path.relative(baseDir, filePath)}`)
  console.log(
    `\nUse it wrapped in a sized/colored element, since props aren't wired through to components yet:`,
  )
  console.log(`  <span class="w-5 h-5 text-emerald-400"><${name} /></span>`)
}
