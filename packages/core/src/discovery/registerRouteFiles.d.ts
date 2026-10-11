import type { Router } from '../router/Router.js'

export declare function registerRouteFiles(
  router: Router,
  baseDir: string,
  options?: { secret?: string },
): Promise<string[]>