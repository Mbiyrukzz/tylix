import pg from 'pg'
import mysql from 'mysql2/promise'

export async function ensureDatabaseExists(databaseConfig) {
  const { driver } = databaseConfig
  if (driver === 'postgres') {
    await ensurePostgresDatabase(databaseConfig)
  } else if (driver === 'mysql') {
    await ensureMysqlDatabase(databaseConfig)
  }
  // sqlite: the file is created automatically on connect, nothing to do here.
  // mongodb: databases/collections are created lazily on first write, nothing to do here.
}

async function ensurePostgresDatabase({
  connectionString,
  host,
  port,
  user,
  password,
  database,
}) {
  // A connection string can already point at a specific target db and
  // may not even include a "postgres" admin database to fall back to --
  // safest to skip auto-create rather than guess at rewriting it.
  if (connectionString) return

  const adminPool = new pg.Pool({
    host,
    port,
    user,
    password,
    database: 'postgres',
  })
  try {
    const { rows } = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    )
    if (rows.length === 0) {
      // Postgres doesn't support "CREATE DATABASE IF NOT EXISTS", and
      // database names can't be parameterized -- quote defensively.
      await adminPool.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`)
    }
  } finally {
    await adminPool.end()
  }
}

async function ensureMysqlDatabase({ host, port, user, password, database }) {
  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
  })
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '``')}\``,
    )
  } finally {
    await connection.end()
  }
}
