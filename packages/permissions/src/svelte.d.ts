import type { Ability, AccessSource, Requirement } from './client.js'
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void
}
export function abilityStore(source: Readable<AccessSource> | AccessSource): Readable<Ability>
export function can(node: HTMLElement, params: [Requirement, AccessSource | Ability]): { update(params: [Requirement, AccessSource | Ability]): void }
