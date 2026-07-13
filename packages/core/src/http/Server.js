import http from "node:http";
import { enhanceResponse } from "./enhanceResponse.js";
import { parseBody } from "./parseBody.js";

export class Server {
  constructor(router) {
    this.router = router;
  }

  createHandler() {
    return async (req, res) => {
      enhanceResponse(res);

      const match = this.router.match(req.method, req.url);
      if (!match) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      req.params = match.params;

      try {
        req.body = await parseBody(req);
      } catch (err) {
        res.status(400).json({ error: err.message });
        return;
      }

      try {
        await match.handler(req, res);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    };
  }

  listen(port, callback) {
    const server = http.createServer(this.createHandler());
    return server.listen(port, callback);
  }
}
