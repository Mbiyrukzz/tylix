import fs from 'node:fs/promises'
import path from 'node:path'

function buildDatabaseBlock(config) {
  const projectSlug = config.projectName

  switch (config.database) {
    case 'sqlite':
      return { driver: 'sqlite', filename: 'database.sqlite' }
    case 'postgres':
      return {
        driver: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'postgres',
        password: '',
        database: projectSlug,
      }
    case 'mysql':
      return {
        driver: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: projectSlug,
      }
    case 'mongodb':
      return {
        driver: 'mongodb',
        url: 'mongodb://localhost:27017',
        database: projectSlug,
      }
    case 'none':
      return null
    default:
      throw new Error(`Unknown database choice "${config.database}"`)
  }
}

export async function writeDatabaseConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const database = buildDatabaseBlock(config)

  const configObject = database ? { database } : {}
  const content = `export default ${JSON.stringify(configObject, null, 2)};\n`

  await fs.writeFile(path.join(targetDir, 'tylix.config.js'), content)
}
