import { loadConfig } from "@tylix/shared";
import { createAdapter, ConnectionManager } from "@tylix/orm";

export async function bootstrapDatabase(cwd = process.cwd()) {
  const config = await loadConfig(cwd);
  const adapter = createAdapter(config.database);
  await adapter.connect();
  ConnectionManager.setAdapter(adapter);
  return adapter;
}
