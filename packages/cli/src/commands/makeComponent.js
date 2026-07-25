import fs from 'node:fs/promises'
import path from 'node:path'

export async function makeComponent(name) {
  const baseDir = process.cwd()
  const relativePath = `${name}.tyx`
  const filePath = path.join(
    baseDir,
    'app',
    'pages',
    'components',
    relativePath,
  )
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const componentName = path.basename(name)
  await fs.writeFile(
    filePath,
    `component ${componentName}\n\nprops\n\ntemplate\n  <div>\n    <!-- ${componentName} -->\n  </div>\n`,
  )

  console.log(`\n✔ Component created: ${path.relative(baseDir, filePath)}\n`)
}
