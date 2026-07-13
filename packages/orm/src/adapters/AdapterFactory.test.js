import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapter } from "./AdapterFactory.js";
import { SqliteAdapter } from "./SqliteAdapter.js";

test("creates a SqliteAdapter for driver: sqlite", () => {
  const adapter = createAdapter({ driver: "sqlite", filename: "test.sqlite" });
  assert.ok(adapter instanceof SqliteAdapter);
  assert.equal(adapter.filename, "test.sqlite");
});

test("throws on unknown driver", () => {
  assert.throws(
    () => createAdapter({ driver: "mongodb" }),
    /Unknown database driver "mongodb"/
  );
});
