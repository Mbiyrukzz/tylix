import fs from 'node:fs/promises'
import path from 'node:path'

export async function makeIcon(name, pathData) {
  const baseDir = process.cwd()
  const iconsDir = path.join(baseDir, 'app', 'pages', 'components')
  await fs.mkdir(iconsDir, { recursive: true })

  const filePath = path.join(iconsDir, `${name}.tyx`)
  const content = `component ${name}

props
  class?: string

template
  <svg class='{{ class or "w-5 h-5" }}' fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="${pathData}" />
  </svg>
`

  await fs.writeFile(filePath, content)
  console.log(`✔ Icon created: ${path.relative(baseDir, filePath)}`)
  console.log(`\nSize and color pass straight through as a class prop:`)
  console.log(`  <${name} class="w-5 h-5 text-emerald-400" />`)
}
