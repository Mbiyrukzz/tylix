import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "./Router.js";

// match() returns a composed chain (global middleware, route
// middleware, then the final handler), so tests run the chain and
// check what the original handler saw.
async function run(match) {
  const req = {};
  const res = {};
  await match.handler(req, res);
  return { req, res };
}

test("matches an exact static route", async () => {
  const router = new Router();
  let calls = 0;
  router.get("/api/posts", () => {
    calls++;
  });

  const match = router.match("GET", "/api/posts");
  assert.ok(match);
  assert.deepEqual(match.params, {});

  await run(match);
  assert.equal(calls, 1);
});

test("matches a dynamic route and extracts params", async () => {
  const router = new Router();
  let calls = 0;
  router.get("/api/posts/:id", () => {
    calls++;
  });

  const match = router.match("GET", "/api/posts/42");
  assert.ok(match);
  assert.deepEqual(match.params, { id: "42" });

  await run(match);
  assert.equal(calls, 1);
});

test("differentiates by HTTP method", async () => {
  const router = new Router();
  const seen = [];
  router.get("/api/posts", () => seen.push("get"));
  router.post("/api/posts", () => seen.push("post"));

  await run(router.match("GET", "/api/posts"));
  await run(router.match("POST", "/api/posts"));

  assert.deepEqual(seen, ["get", "post"]);
});

test("returns null when no route matches", () => {
  const router = new Router();
  router.get("/api/posts", () => {});
  assert.equal(router.match("GET", "/api/nonexistent"), null);
});

test("ignores query string when matching", async () => {
  const router = new Router();
  let calls = 0;
  router.get("/api/posts", () => {
    calls++;
  });

  const match = router.match("GET", "/api/posts?page=2");
  assert.ok(match);

  await run(match);
  assert.equal(calls, 1);
});

test("runs global middleware, then route middleware, then the handler, in order", async () => {
  const router = new Router();
  const order = [];

  router.use(async (req, res, next) => {
    order.push("global");
    await next();
  });
  router.get(
    "/api/posts",
    async (req, res, next) => {
      order.push("route");
      await next();
    },
    () => {
      order.push("handler");
    },
  );

  await run(router.match("GET", "/api/posts"));
  assert.deepEqual(order, ["global", "route", "handler"]);
});

test("a middleware that does not call next() stops the chain", async () => {
  const router = new Router();
  let handlerCalled = false;

  router.use(() => {
    // deliberately never calls next()
  });
  router.get("/api/posts", () => {
    handlerCalled = true;
  });

  await run(router.match("GET", "/api/posts"));
  assert.equal(handlerCalled, false);
});

test("calling next() twice in one middleware rejects", async () => {
  const router = new Router();

  router.use(async (req, res, next) => {
    await next();
    await next();
  });
  router.get("/api/posts", () => {});

  await assert.rejects(
    () => run(router.match("GET", "/api/posts")),
    /next\(\) called multiple times/,
  );
});