import fs from 'node:fs/promises'
import path from 'node:path'
import { pascalCase } from '@tylix/shared'

export async function makeComponent(name) {
  const componentName = pascalCase(name)
  const baseDir = process.cwd()
  const componentsDir = path.join(baseDir, 'app', 'pages', 'components')
  await fs.mkdir(componentsDir, { recursive: true })

  const filePath = path.join(componentsDir, `${componentName}.tyx`)
  const content = `component ${componentName}

state
  

template
  <div>
    ${componentName}
  </div>
`
  await fs.writeFile(filePath, content)
  console.log(
    `\n✔ Component "${componentName}" created: app/pages/components/${componentName}.tyx\n`,
  )
}
