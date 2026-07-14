import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  Router,
  Server,
  discoverFeatures,
  registerFeatureRoutes,
  requireAuth,
} from "@tylix/core";
import { loadConfig } from "@tylix/shared";
import { bootstrapDatabase } from "../bootstrap.js";

async function registerAuthRoutes(router, baseDir, authConfig) {
  const controllerPath = path.join(baseDir, "app", "controllers", "AuthController.js");
  const exists = await fs.access(controllerPath).then(() => true).catch(() => false);
  if (!exists) return false;

  const { AuthController } = await import(pathToFileURL(controllerPath).href);
  const controller = new AuthController({
    secret: authConfig.secret,
    tokenExpiresInSeconds: authConfig.tokenExpiresInSeconds,
  });

  router.post("/api/register", (req, res) => controller.register(req, res));
  router.post("/api/login", (req, res) => controller.login(req, res));
  router.get("/api/me", requireAuth((req, res) => controller.me(req, res), authConfig.secret));

  return true;
}

export async function dev({ port = 3000 } = {}) {
  const baseDir = process.cwd();
  const config = await loadConfig(baseDir);

  await bootstrapDatabase();

  const features = await discoverFeatures(baseDir);

  const router = new Router();
  registerFeatureRoutes(router, features);

  const authEnabled = await registerAuthRoutes(router, baseDir, config.auth);

  router.get("/", (req, res) => {
    res.json({
      message: "Tylix dev server running",
      features: features.map((f) => f.manifest.name),
      auth: authEnabled ? ["/api/register", "/api/login", "/api/me"] : [],
    });
  });

  const server = new Server(router);
  server.listen(port, () => {
    console.log(`\n✔ Tylix dev server running at http://localhost:${port}\n`);
    console.log(`Registered features: ${features.map((f) => f.manifest.name).join(", ") || "(none)"}`);
    for (const { manifest } of features) {
      console.log(`  /api/${manifest.table} -> ${manifest.controller}`);
    }
    if (authEnabled) {
      console.log(`  /api/register, /api/login, /api/me -> AuthController`);
    }
    console.log();
  });
}
