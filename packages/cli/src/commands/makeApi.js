import fs from 'node:fs/promises'
import path from 'node:path'

export async function makeApi(name) {
  const baseDir = process.cwd()
  const apiDir = path.join(baseDir, 'app', 'useApi')
  await fs.mkdir(apiDir, { recursive: true })

  const filePath = path.join(apiDir, `${name}.js`)
  await fs.writeFile(
    filePath,
    `export const ${name} = (table, data) => useApi(\`/api/\${table}\`, { method: 'POST', body: data })\n`,
  )

  console.log(`\n✔ API helper created: ${path.relative(baseDir, filePath)}\n`)
}
