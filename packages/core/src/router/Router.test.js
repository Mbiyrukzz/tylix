import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "./Router.js";

test("matches an exact static route", () => {
  const router = new Router();
  const handler = () => {};
  router.get("/api/posts", handler);

  const match = router.match("GET", "/api/posts");
  assert.equal(match.handler, handler);
  assert.deepEqual(match.params, {});
});

test("matches a dynamic route and extracts params", () => {
  const router = new Router();
  const handler = () => {};
  router.get("/api/posts/:id", handler);

  const match = router.match("GET", "/api/posts/42");
  assert.equal(match.handler, handler);
  assert.deepEqual(match.params, { id: "42" });
});

test("differentiates by HTTP method", () => {
  const router = new Router();
  const getHandler = () => {};
  const postHandler = () => {};
  router.get("/api/posts", getHandler);
  router.post("/api/posts", postHandler);

  assert.equal(router.match("GET", "/api/posts").handler, getHandler);
  assert.equal(router.match("POST", "/api/posts").handler, postHandler);
});

test("returns null when no route matches", () => {
  const router = new Router();
  router.get("/api/posts", () => {});
  assert.equal(router.match("GET", "/api/nonexistent"), null);
});

test("ignores query string when matching", () => {
  const router = new Router();
  const handler = () => {};
  router.get("/api/posts", handler);

  const match = router.match("GET", "/api/posts?page=2");
  assert.equal(match.handler, handler);
});
