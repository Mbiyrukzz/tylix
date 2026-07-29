import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

export async function makeApi(name) {
  const baseDir = process.cwd()
  const apiDir = path.join(baseDir, 'app', 'useApi')
  await fs.mkdir(apiDir, { recursive: true })

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

  const filePath = path.join(apiDir, `${name}.${ext}`)
  const source =
    language === 'typescript'
      ? `export const ${name} = (table: string, data: unknown) => useApi(\`/api/\${table}\`, { method: 'POST', body: data })\n`
      : `export const ${name} = (table, data) => useApi(\`/api/\${table}\`, { method: 'POST', body: data })\n`

  await fs.writeFile(filePath, source)

  console.log(`\n✔ API helper created: ${path.relative(baseDir, filePath)}\n`)
}
