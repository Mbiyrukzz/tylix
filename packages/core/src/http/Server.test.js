import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../router/Router.js";
import { Server } from "./Server.js";

test("handles a matched GET route", async () => {
  const router = new Router();
  router.get("/api/ping", (req, res) => res.json({ pong: true }));

  const server = new Server(router);
  const httpServer = server.listen(0);
  const { port } = httpServer.address();

  const response = await fetch(`http://localhost:${port}/api/ping`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { pong: true });

  httpServer.close();
});

test("returns 404 for unmatched routes", async () => {
  const router = new Router();
  const server = new Server(router);
  const httpServer = server.listen(0);
  const { port } = httpServer.address();

  const response = await fetch(`http://localhost:${port}/nonexistent`);
  assert.equal(response.status, 404);

  httpServer.close();
});

test("parses JSON body and passes params to handler", async () => {
  const router = new Router();
  router.post("/api/echo/:id", (req, res) => {
    res.json({ id: req.params.id, body: req.body });
  });

  const server = new Server(router);
  const httpServer = server.listen(0);
  const { port } = httpServer.address();

  const response = await fetch(`http://localhost:${port}/api/echo/42`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Hello" }),
  });
  const body = await response.json();

  assert.deepEqual(body, { id: "42", body: { title: "Hello" } });

  httpServer.close();
});

test("parses query string into req.query", async () => {
  const router = new Router();
  router.get("/api/comments/:id", (req, res) => {
    res.json({ id: req.params.id, include: req.query.include ?? null });
  });

  const server = new Server(router);
  const httpServer = server.listen(0);
  const { port } = httpServer.address();

  const response = await fetch(`http://localhost:${port}/api/comments/1?include=post`);
  const body = await response.json();

  assert.deepEqual(body, { id: "1", include: "post" });

  httpServer.close();
});

test("calls notFoundHandler when no route matches, and skips 404 if it handles the request", async () => {
  const router = new Router();
  const server = new Server(router, {
    notFoundHandler: async (req, res) => {
      if (req.url === "/static-file.txt") {
        res.setHeader("Content-Type", "text/plain");
        res.end("served by fallback");
        return true;
      }
      return false;
    },
  });

  const httpServer = server.listen(0);
  const { port } = httpServer.address();

  const handled = await fetch(`http://localhost:${port}/static-file.txt`);
  const handledBody = await handled.text();
  assert.equal(handledBody, "served by fallback");

  const unhandled = await fetch(`http://localhost:${port}/nonexistent`);
  assert.equal(unhandled.status, 404);

  httpServer.close();
});
