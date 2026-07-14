import { SqliteAdapter } from "./SqliteAdapter.js";
import { PostgresAdapter } from "./PostgresAdapter.js";
import { MysqlAdapter } from "./MysqlAdapter.js";
import { MongoAdapter } from "./MongoAdapter.js";

const ADAPTERS = {
  sqlite: SqliteAdapter,
  postgres: PostgresAdapter,
  mysql: MysqlAdapter,
  mongodb: MongoAdapter,
};

export function createAdapter(databaseConfig) {
  const { driver, ...options } = databaseConfig;

  const AdapterClass = ADAPTERS[driver];
  if (!AdapterClass) {
    throw new Error(
      `Unknown database driver "${driver}". Available drivers: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }

  return new AdapterClass(options);
}
