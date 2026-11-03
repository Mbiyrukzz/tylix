import type { Router } from '../router/Router.js'

export declare function loadCustomRoutes(
  router: Router,
  baseDir: string,
  options?: { secret?: string; hydrate?: unknown },
): Promise<boolean>