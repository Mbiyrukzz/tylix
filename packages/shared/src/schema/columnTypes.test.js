import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveColumnType } from "./columnTypes.js";

test("maps known field types to schema column types", () => {
  assert.equal(resolveColumnType("string"), "string");
  assert.equal(resolveColumnType("text"), "text");
  assert.equal(resolveColumnType("boolean"), "boolean");
  assert.equal(resolveColumnType("email"), "string");
});

test("throws on unknown field type", () => {
  assert.throws(() => resolveColumnType("nonsense"), /Unknown field type/);
});
