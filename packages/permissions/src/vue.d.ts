import type { ComputedRef, MaybeRef, Plugin } from 'vue'
import type { Ability, AccessSource, Requirement } from './client.js'
export function permissionsPlugin(source: MaybeRef<AccessSource> | (() => AccessSource)): Plugin
export function useAbility(): ComputedRef<Ability>
export function useCan(requirement: MaybeRef<Requirement>): ComputedRef<boolean>
export function useHasRole(role: MaybeRef<string | string[]>): ComputedRef<boolean>
declare module 'vue' {
  interface ComponentCustomProperties {
    $can(requirement: Requirement): boolean
  }
}
