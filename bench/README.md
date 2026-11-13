# HTTP benchmarks

Tylix's server (`@tylix/core`) against plain `node:http`, Fastify, Hono and
Express, on the same three routes:

- `GET /hello`: a small JSON response
- `GET /users/:id`: a route parameter, with 50 other routes registered first
- `POST /echo`: a JSON body parsed and sent back

Each server runs in its own process; [autocannon](https://github.com/mcollina/autocannon)
sends the load. Tylix runs without its access log by default, like the
others (Fastify logs nothing unless asked).

```sh
cd bench
npm install
npm run bench                                   # all servers, 5s per scenario
node run.mjs --only tylix,fastify --duration 10
TYLIX_ACCESS_LOG=true node run.mjs --only tylix # with the access log
BENCH_WORKERS=4 node run.mjs --only tylix-workers
node run.mjs --json results.json                # save the numbers
```

Numbers depend on the machine: compare servers within one run, and run the
load generator on a separate machine when measuring workers, or it takes
CPU from the servers it measures.

This folder is not part of the workspaces; its dependencies are only for
measuring and never reach a Tylix app.
