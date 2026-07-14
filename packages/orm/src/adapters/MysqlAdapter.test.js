import { test } from "node:test";
import assert from "node:assert/strict";
import { MysqlAdapter } from "./MysqlAdapter.js";

test("columnType maps logical types to MySQL SQL types", () => {
  const adapter = new MysqlAdapter({ database: "test" });
  assert.equal(adapter.columnType("increments"), "INT AUTO_INCREMENT PRIMARY KEY");
  assert.equal(adapter.columnType("string"), "VARCHAR(255)");
  assert.equal(adapter.columnType("boolean"), "TINYINT(1)");
  assert.equal(adapter.columnType("json"), "JSON");
});

test("columnType throws on unknown logical type", () => {
  const adapter = new MysqlAdapter({ database: "test" });
  assert.throws(() => adapter.columnType("nonsense"), /no mapping/);
});

test("ensureConnected throws before connect() is called", async () => {
  const adapter = new MysqlAdapter({ database: "test" });
  await assert.rejects(() => adapter.all("SELECT 1"));
});
