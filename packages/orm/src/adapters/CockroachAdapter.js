import { PostgresAdapter } from './PostgresAdapter.js'

// CockroachDB speaks the PostgreSQL wire protocol, so this is the Postgres
// adapter with three session settings, applied to every pooled connection:
//
//   serial_normalization = sql_sequence   SERIAL ids count 1, 2, 3 (from a
//                                         sequence) instead of 64-bit
//                                         unique_rowid() values that
//                                         JavaScript numbers can't hold.
//   default_int_size = 4                  INT / SERIAL are 4 bytes, as on
//                                         PostgreSQL, so ids come back as
//                                         numbers, not strings.
//   enable_experimental_alter_column_type_general = true
//                                         lets ->change() migrations alter
//                                         a column's type.
const SESSION = [
  "SET serial_normalization = 'sql_sequence'",
  'SET default_int_size = 4',
  'SET enable_experimental_alter_column_type_general = true',
]

export class CockroachAdapter extends PostgresAdapter {
  constructor({ connectionString, host, port = 26257, user = 'root', password, database, ssl } = {}) {
    super({ connectionString, host, port, user, password, database, ssl })
  }

  get dialect() {
    return 'cockroach'
  }

  get driverName() {
    return 'cockroach'
  }

  async onConnect(client) {
    for (const statement of SESSION) await client.query(statement)
  }

  async listTables() {
    const result = await this.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
    )
    return result.rows.map((r) => r.table_name)
  }
}
