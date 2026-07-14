import { test } from "node:test";
import assert from "node:assert/strict";
import { Blueprint } from "./Blueprint.js";

test("derives PascalCase name and pluralized table name", () => {
  const bp = new Blueprint("post");
  assert.equal(bp.name, "Post");
  assert.equal(bp.tableName, "posts");
});

test("field() accumulates fields and returns this for chaining", () => {
  const bp = new Blueprint("Post")
    .field("title", "string")
    .field("slug", "string", { unique: true });

  assert.equal(bp.fields.length, 2);
  assert.deepEqual(bp.fields[1], { name: "slug", type: "string", unique: true });
});

test("option methods toggle flags and chain", () => {
  const bp = new Blueprint("Post").timestamps().softDeletes().api().crud();
  assert.equal(bp.options.timestamps, true);
  assert.equal(bp.options.softDeletes, true);
  assert.equal(bp.options.api, true);
  assert.equal(bp.options.crud, true);
});

test("table() overrides derived table name", () => {
  const bp = new Blueprint("Person").table("people");
  assert.equal(bp.tableName, "people");
});

test("toJSON returns a plain serializable object", () => {
  const bp = new Blueprint("Post").field("title", "string").api();
  const json = bp.toJSON();
  assert.equal(json.name, "Post");
  assert.equal(json.table, "posts");
  assert.equal(json.options.api, true);
});

test("belongsTo() adds a foreign key field and records relation metadata", () => {
  const bp = new Blueprint("Comment").belongsTo("Post");
  assert.equal(bp.fields.length, 1);
  assert.deepEqual(bp.fields[0], { name: "post_id", type: "integer" });
  assert.deepEqual(bp.relations, [{ type: "belongsTo", model: "Post", foreignKey: "post_id" }]);
});

test("belongsTo() accepts a custom foreignKey", () => {
  const bp = new Blueprint("Comment").belongsTo("Post", { foreignKey: "article_id" });
  assert.equal(bp.fields[0].name, "article_id");
  assert.equal(bp.relations[0].foreignKey, "article_id");
});
