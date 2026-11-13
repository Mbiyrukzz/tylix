import type { DefineComponent } from 'vue'

type ChartComponent = DefineComponent<{
  type?: string
  series?: unknown[]
  data?: unknown
  value?: number
  options?: Record<string, unknown>
  crosshair?: boolean
  id?: string
}>
export const Chart: ChartComponent
export const Sparkline: ChartComponent
export const LineChart: ChartComponent
export const AreaChart: ChartComponent
export const BarChart: ChartComponent
export const PieChart: ChartComponent
export const DonutChart: ChartComponent
export const ScatterChart: ChartComponent
export const Gauge: ChartComponent
export const Heatmap: ChartComponent
