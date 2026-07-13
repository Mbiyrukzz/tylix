import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function discoverFeatures(baseDir) {
  const featuresDir = path.join(baseDir, "app", "Features");
  const exists = await fs.access(featuresDir).then(() => true).catch(() => false);
  if (!exists) return [];

  const entries = await fs.readdir(featuresDir, { withFileTypes: true });
  const features = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(featuresDir, entry.name, "feature.json");
    const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
    if (!manifestExists) continue;

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    const controllerPath = path.join(baseDir, "app", "controllers", `${manifest.controller}.js`);
    const controllerModule = await import(pathToFileURL(controllerPath).href);
    const ControllerClass = controllerModule[manifest.controller];

    features.push({ manifest, controller: new ControllerClass() });
  }

  return features;
}
