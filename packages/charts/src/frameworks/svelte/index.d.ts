import type { Component } from 'svelte'
import type { ChartType } from '../../index.js'

export const Chart: Component<{
  type: ChartType
  series?: unknown[]
  data?: unknown
  value?: number
  options?: Record<string, unknown>
  crosshair?: boolean
  id?: string
  class?: string
  style?: string
  [option: string]: unknown
}>
