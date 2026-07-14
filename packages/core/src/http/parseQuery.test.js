import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "./parseQuery.js";

test("returns empty object when there is no query string", () => {
  assert.deepEqual(parseQuery("/api/posts"), {});
});

test("parses a single query param", () => {
  assert.deepEqual(parseQuery("/api/comments/1?include=post"), { include: "post" });
});

test("parses multiple query params", () => {
  assert.deepEqual(parseQuery("/api/posts?page=2&limit=10"), { page: "2", limit: "10" });
});
