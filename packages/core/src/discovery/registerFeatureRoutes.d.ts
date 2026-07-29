import type { Router } from '../router/Router.js'
import type { DiscoveredFeature } from './discoverFeatures.js'

export declare function registerFeatureRoutes(
  router: Router,
  features: DiscoveredFeature[],
  options?: { secret?: string },
): void