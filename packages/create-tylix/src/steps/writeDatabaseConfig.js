import fs from 'node:fs/promises'
import path from 'node:path'

function buildTylixConfigContent(config) {
  const projectSlug = config.projectName
  const authBlock = `
  auth: {
    secret: process.env.AUTH_SECRET,
    tokenExpiresInSeconds: 60 * 60 * 24 * 7,
  },`

  switch (config.database) {
    case 'sqlite':
      return `export default {
  database: {
    driver: process.env.DATABASE_DRIVER || 'sqlite',
    filename: process.env.DATABASE_FILENAME || 'database.sqlite',
  },${authBlock}
};
`
    case 'postgres':
      return `export default {
  database: {
    driver: process.env.DATABASE_DRIVER || 'postgres',
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT) || 5432,
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || '${projectSlug}',
  },${authBlock}
};
`
    case 'mysql':
      return `export default {
  database: {
    driver: process.env.DATABASE_DRIVER || 'mysql',
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || '${projectSlug}',
  },${authBlock}
};
`
    case 'mongodb':
      return `export default {
  database: {
    driver: process.env.DATABASE_DRIVER || 'mongodb',
    url: process.env.DATABASE_URL || 'mongodb://localhost:27017',
    database: process.env.DATABASE_NAME || '${projectSlug}',
  },${authBlock}
};
`
    case 'none':
      return `export default {${authBlock}
};
`
    default:
      throw new Error(`Unknown database choice "${config.database}"`)
  }
}

export async function writeDatabaseConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const content = buildTylixConfigContent(config)
  await fs.writeFile(path.join(targetDir, `tylix.config.${ext}`), content)
}
