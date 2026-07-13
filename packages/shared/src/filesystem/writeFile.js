import fs from "node:fs/promises";
import path from "node:path";

export async function writeFile(filePath, content, { overwrite = false } = {}) {
  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  if (exists && !overwrite) {
    throw new Error(`File already exists: ${filePath}. Pass { overwrite: true } to replace it.`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}
