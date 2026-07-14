import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectSql } from "./buildSelectSql.js";

test("builds a plain SELECT with no conditions", () => {
  const { sql, params } = buildSelectSql("posts", {});
  assert.equal(sql, "SELECT * FROM posts");
  assert.deepEqual(params, []);
});

test("builds a WHERE clause with = operator", () => {
  const { sql, params } = buildSelectSql("posts", {
    wheres: [{ field: "status", operator: "=", value: "published" }],
  });
  assert.equal(sql, "SELECT * FROM posts WHERE status = ?");
  assert.deepEqual(params, ["published"]);
});

test("builds multiple WHERE clauses joined by AND", () => {
  const { sql, params } = buildSelectSql("posts", {
    wheres: [
      { field: "status", operator: "=", value: "published" },
      { field: "views", operator: ">", value: 100 },
    ],
  });
  assert.equal(sql, "SELECT * FROM posts WHERE status = ? AND views > ?");
  assert.deepEqual(params, ["published", 100]);
});

test("builds an ORDER BY clause", () => {
  const { sql } = buildSelectSql("posts", {
    orders: [{ field: "created_at", direction: "DESC" }],
  });
  assert.equal(sql, "SELECT * FROM posts ORDER BY created_at DESC");
});

test("inlines LIMIT and OFFSET as validated integers, not placeholders", () => {
  const { sql, params } = buildSelectSql("posts", { limitValue: 10, offsetValue: 20 });
  assert.equal(sql, "SELECT * FROM posts LIMIT 10 OFFSET 20");
  assert.deepEqual(params, []);
});

test("combines where, orderBy, and limit together", () => {
  const { sql, params } = buildSelectSql("posts", {
    wheres: [{ field: "status", operator: "=", value: "published" }],
    orders: [{ field: "created_at", direction: "ASC" }],
    limitValue: 5,
  });
  assert.equal(sql, "SELECT * FROM posts WHERE status = ? ORDER BY created_at ASC LIMIT 5");
  assert.deepEqual(params, ["published"]);
});

test("throws on an unsupported operator", () => {
  assert.throws(
    () => buildSelectSql("posts", { wheres: [{ field: "x", operator: "LIKE", value: "y" }] }),
    /Unsupported where operator/
  );
});
