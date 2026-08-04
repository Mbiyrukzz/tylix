import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

export async function makeService(name) {
  const baseDir = process.cwd()
  const servicesDir = path.join(baseDir, 'app', 'services')
  await fs.mkdir(servicesDir, { recursive: true })

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'
  const isTs = language === 'typescript'

  const className = `${name}Service`
  const filePath = path.join(servicesDir, `${className}.${ext}`)

  const source = isTs
    ? `export class ${className} {
  constructor() {}
}
`
    : `export class ${className} {
  constructor() {}
}
`

  await fs.writeFile(filePath, source)

  console.log(`\n✔ Service created: ${path.relative(baseDir, filePath)}\n`)
}
