import { MysqlAdapter } from './MysqlAdapter.js'

// MariaDB speaks the MySQL protocol, so this is the MySQL adapter (mysql2
// driver) under its own name: errors and banners say MariaDB, and the
// schema builder uses what MariaDB adds (CREATE INDEX IF NOT EXISTS,
// ADD COLUMN IF NOT EXISTS).
export class MariadbAdapter extends MysqlAdapter {
  get dialect() {
    return 'mariadb'
  }

  get driverName() {
    return 'mariadb'
  }
}
