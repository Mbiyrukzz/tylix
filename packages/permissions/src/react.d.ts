import type { ReactNode, ReactElement } from 'react'
import type { Ability, AccessSource, Requirement } from './client.js'
export function PermissionsProvider(props: { user?: AccessSource; access?: AccessSource; children?: ReactNode }): ReactElement
export function useAbility(): Ability
export function useCan(requirement: Requirement): boolean
export function useHasRole(role: string | string[]): boolean
export function Can(props: {
  permission?: string | string[]
  any?: string[]
  role?: string | string[]
  not?: boolean
  fallback?: ReactNode
  children?: ReactNode
}): ReactElement
