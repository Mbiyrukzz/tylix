import {
  Router,
  Server,
  discoverFeatures,
  registerFeatureRoutes,
} from "@tylix/core";
import { bootstrapDatabase } from "../bootstrap.js";

export async function dev({ port = 3000 } = {}) {
  await bootstrapDatabase();

  const baseDir = process.cwd();
  const features = await discoverFeatures(baseDir);

  const router = new Router();
  registerFeatureRoutes(router, features);

  router.get("/", (req, res) => {
    res.json({
      message: "Tylix dev server running",
      features: features.map((f) => f.manifest.name),
    });
  });

  const server = new Server(router);
  server.listen(port, () => {
    console.log(`\n✔ Tylix dev server running at http://localhost:${port}\n`);
    console.log(`Registered features: ${features.map((f) => f.manifest.name).join(", ") || "(none)"}`);
    for (const { manifest } of features) {
      console.log(`  /api/${manifest.table} -> ${manifest.controller}`);
    }
    console.log();
  });
}
