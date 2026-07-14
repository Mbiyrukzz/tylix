import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapter } from "./AdapterFactory.js";
import { SqliteAdapter } from "./SqliteAdapter.js";
import { PostgresAdapter } from "./PostgresAdapter.js";
import { MysqlAdapter } from "./MysqlAdapter.js";
import { MongoAdapter } from "./MongoAdapter.js";

test("creates a SqliteAdapter for driver: sqlite", () => {
  const adapter = createAdapter({ driver: "sqlite", filename: "test.sqlite" });
  assert.ok(adapter instanceof SqliteAdapter);
  assert.equal(adapter.filename, "test.sqlite");
});

test("throws on unknown driver", () => {
  assert.throws(
    () => createAdapter({ driver: "oracle" }),
    /Unknown database driver "oracle"/
  );
});

test("creates a PostgresAdapter for driver: postgres", () => {
  const adapter = createAdapter({ driver: "postgres", database: "test" });
  assert.ok(adapter instanceof PostgresAdapter);
});

test("creates a MysqlAdapter for driver: mysql", () => {
  const adapter = createAdapter({ driver: "mysql", database: "test" });
  assert.ok(adapter instanceof MysqlAdapter);
});

test("creates a MongoAdapter for driver: mongodb", () => {
  const adapter = createAdapter({ driver: "mongodb", database: "test" });
  assert.ok(adapter instanceof MongoAdapter);
});
