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
import { renderPageDocument } from "@tylix/compiler";
import { watchDirectoryTree, createHmrChannel, HMR_CLIENT_SCRIPT } from "../hotReload.js";

const MIME_TYPES = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Serves static assets from public/ (Tailwind's compiled CSS, logo
// images, favicons). This is a fallback in the Server's 404 handler
// path rather than a router registration, since static filenames
// aren't known ahead of time the way feature/page routes are.
async function serveStaticAsset(req, res, baseDir) {
  const publicDir = path.join(baseDir, "public");
  const urlPath = req.url.split("?")[0];
  const filePath = path.join(publicDir, decodeURIComponent(urlPath));

  if (!filePath.startsWith(publicDir)) return false; // path traversal guard

  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  if (!exists) return false;

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath);
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  res.end(await fs.readFile(filePath));
  return true;
}
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

function injectHmrScript(html) {
  return html.replace("</body>", `${HMR_CLIENT_SCRIPT}</body>`);
}

async function registerPageRoutes(router, baseDir) {
  const pagesDir = path.join(baseDir, "app", "pages");
  const exists = await fs.access(pagesDir).then(() => true).catch(() => false);
  if (!exists) return [];

  const files = (await fs.readdir(pagesDir)).filter((f) => f.endsWith(".tyx"));
  const registered = [];

  // Dev mode always recompiles from source on each request, rather
  // than caching the compiled HTML at startup, so file edits are
  // reflected immediately once combined with the HMR reload signal.
  async function renderFile(file) {
    const source = await fs.readFile(path.join(pagesDir, file), "utf-8");
    return injectHmrScript(renderPageDocument(source));
  }

  for (const file of files) {
    const name = file.replace(/\.tyx$/, "");
    const routePath = `/${name.toLowerCase()}`;

    router.get(routePath, async (req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await renderFile(file));
    });
    registered.push(routePath);

    if (registered.length === 1) {
      router.get("/", async (req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await renderFile(file));
      });
    }
  }

  return registered;
}

const DRIVER_LABELS = {
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
};

function printBanner({ port, driver, featureCount, pageCount, featureRoutes, pageRoutes, authEnabled }) {
  const line = "─".repeat(39);
  console.log(`\n${line}`);
  console.log("        Tylix Framework v0.1");
  console.log(`${line}\n`);
  console.log(`Environment   development`);
  console.log(`Server        http://localhost:${port}`);
  console.log(`Database      ${DRIVER_LABELS[driver] ?? driver}`);
  console.log(`Compiler      Ready`);
  console.log(`ORM           Ready`);
  console.log(`Features      ${featureCount}`);
  console.log(`Pages         ${pageCount}`);
  console.log(`\nRoutes\n`);

  if (pageRoutes.length > 0) {
    console.log(`  GET   /`);
  }
  for (const route of pageRoutes) {
    console.log(`  GET   ${route}`);
  }
  for (const route of featureRoutes) {
    console.log(`  GET     /api/${route.table}`);
    console.log(`  POST    /api/${route.table}`);
    console.log(`  GET     /api/${route.table}/:id`);
    console.log(`  PUT     /api/${route.table}/:id`);
    console.log(`  DELETE  /api/${route.table}/:id`);
  }
  if (authEnabled) {
    console.log(`  POST    /api/register`);
    console.log(`  POST    /api/login`);
    console.log(`  GET     /api/me`);
  }

  console.log(`\nWatching...\n`);
  console.log(`${line}\n`);
}

export async function dev({ port = 3000 } = {}) {
  const baseDir = process.cwd();
  const config = await loadConfig(baseDir);

  await bootstrapDatabase();

  const features = await discoverFeatures(baseDir);
  const router = new Router();
  registerFeatureRoutes(router, features);

  const authEnabled = await registerAuthRoutes(router, baseDir, config.auth);
  const pageRoutes = await registerPageRoutes(router, baseDir);

  const hmr = createHmrChannel(router);
  const watchedDirs = ["pages", "controllers", "models", "validators", "Features"]
    .map((d) => path.join(baseDir, "app", d));
  const watchers = watchedDirs.map((dir) => watchDirectoryTree(dir, () => hmr.notify()));

  if (pageRoutes.length === 0 && features.length === 0) {
    router.get("/", (req, res) => {
      res.json({
        message: "Tylix dev server running",
        features: [],
        auth: authEnabled ? ["/api/register", "/api/login", "/api/me"] : [],
      });
    });
  }

  const server = new Server(router, {
    notFoundHandler: (req, res) => serveStaticAsset(req, res, baseDir),
  });
  server.listen(port, () => {
    printBanner({
      port,
      driver: config.database.driver,
      featureCount: features.length,
      pageCount: pageRoutes.length,
      featureRoutes: features.map((f) => ({ table: f.manifest.table })),
      pageRoutes,
      authEnabled,
    });
  });
}
