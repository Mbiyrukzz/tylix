import type { CSSProperties, FC } from 'react'
import type { ChartType } from '../index.js'

/** Chart options are passed as props (width, height, formatY, legend…), or together in `options`. */
interface Common {
  options?: Record<string, unknown>
  /** Line / area: the interactive hover tooltip. Default true. */
  crosshair?: boolean
  id?: string
  className?: string
  style?: CSSProperties
  [option: string]: unknown
}
export const Chart: FC<Common & { type: ChartType; series?: unknown[]; data?: unknown; value?: number }>
export const Sparkline: FC<Common & { data: Array<number | null> }>
export const LineChart: FC<Common & { series: unknown[] }>
export const AreaChart: FC<Common & { series: unknown[] }>
export const BarChart: FC<Common & { series: unknown[]; categories?: unknown[] }>
export const PieChart: FC<Common & { data: unknown[] }>
export const DonutChart: FC<Common & { data: unknown[] }>
export const ScatterChart: FC<Common & { series: unknown[] }>
export const Gauge: FC<Common & { value: number }>
export const Heatmap: FC<Common & { data: unknown }>
