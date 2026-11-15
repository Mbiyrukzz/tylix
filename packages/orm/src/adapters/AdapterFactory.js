import { SqliteAdapter } from './SqliteAdapter.js'
import { PostgresAdapter } from './PostgresAdapter.js'
import { MysqlAdapter } from './MysqlAdapter.js'
import { MongoAdapter } from './MongoAdapter.js'
import { CockroachAdapter } from './CockroachAdapter.js'
import { MariadbAdapter } from './MariadbAdapter.js'

const ADAPTERS = {
  sqlite: SqliteAdapter,
  postgres: PostgresAdapter,
  mysql: MysqlAdapter,
  mariadb: MariadbAdapter,
  cockroach: CockroachAdapter,
  mongodb: MongoAdapter,
}

export function createAdapter(databaseConfig) {
  const { driver, ...options } = databaseConfig

  const AdapterClass = ADAPTERS[driver]
  if (!AdapterClass) {
    throw new Error(
      `Unknown database driver "${driver}". Available drivers: ${Object.keys(ADAPTERS).join(', ')}`,
    )
  }

  return new AdapterClass(options)
}
