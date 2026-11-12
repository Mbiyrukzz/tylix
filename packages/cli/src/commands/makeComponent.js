import fs from 'node:fs/promises'
import path from 'node:path'
import { componentFile } from '../frontend/generateFiles.js'
import { projectFrontend } from './makePage.js'

async function exists(file) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

// tylix make:component <Name>
// Native projects get a .tyx component under app/pages/components (its file
// name is its tag). Hosted frontends get one in their own format under
// app/frontend/components.
export async function makeComponent(name) {
  const baseDir = process.cwd()
  const { driver, ts } = await projectFrontend(baseDir)
  const rel = (p) => path.relative(baseDir, p)

  let filePath
  let content
  if (driver === 'tylix') {
    filePath = path.join(baseDir, 'app', 'pages', 'components', `${name}.tyx`)
    const componentName = path.basename(name)
    content = `component ${componentName}\n\nprops\n\ntemplate\n  <div>\n    <!-- ${componentName} -->\n  </div>\n`
  } else {
    const component = componentFile(driver, name, { ts })
    filePath = path.join(baseDir, 'app', 'frontend', component.file)
    content = component.content
  }

  if (await exists(filePath)) throw new Error(`${rel(filePath)} already exists.`)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
  console.log(`\n✔ Component created: ${rel(filePath)}\n`)
}
