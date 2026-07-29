export interface FeatureManifest {
  name: string
  version: string
  table: string
  model: string
  controller: string
  validator: string
  language: 'javascript' | 'typescript'
  fields: unknown[]
  relations: unknown[]
  auth: boolean
  permissions: string[]
}

export interface DiscoveredFeature {
  manifest: FeatureManifest
  controller: unknown
}

export declare function discoverFeatures(baseDir: string): Promise<DiscoveredFeature[]>