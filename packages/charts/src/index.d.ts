export interface LinearScale {
  (value: number): number
  invert(px: number): number
  domain(): [number, number]
  range(): [number, number]
  ticks(count?: number): number[]
}

export function linearScale(options?: {
  domain?: [number, number]
  range?: [number, number]
  clamp?: boolean
}): LinearScale

export function niceTicks(min: number, max: number, count?: number): number[]
export function extent(values: Iterable<unknown>): [number, number] | null

export interface PixelPoint {
  x: number | null
  y: number | null
}
export type Curve = 'linear' | 'step'

export function segments<T extends PixelPoint>(points: Array<T | null>): T[][]
export function linePath(points: Array<PixelPoint | null>, options?: { curve?: Curve }): string
export function areaPath(
  points: Array<PixelPoint | null>,
  baselineY: number,
  options?: { curve?: Curve }
): string

export interface SparklineOptions {
  width?: number
  height?: number
  padding?: number
  curve?: Curve
  min?: number
  max?: number
  showLastPoint?: boolean
  label?: string
}

export interface SparklineGeometry {
  width: number
  height: number
  path: string
  areaPath: string
  last: { x: number; y: number; value: number; index: number } | null
  min: number | null
  max: number | null
}

export function sparkline(data?: Array<number | null>, options?: SparklineOptions): SparklineGeometry
export function sparklineSvg(data?: Array<number | null>, options?: SparklineOptions): string

export interface LineSeriesInput {
  name?: string
  color?: string
  data: Array<number | null | { x?: number; y: number | null }>
}

export interface LineChartOptions {
  width?: number
  height?: number
  margin?: Partial<{ top: number; right: number; bottom: number; left: number }>
  xDomain?: [number, number]
  yDomain?: [number, number]
  xTicks?: number
  yTicks?: number
  curve?: Curve
  area?: boolean
  zeroBaseline?: boolean
  formatX?: (value: number) => string
  formatY?: (value: number) => string
  label?: string
}

export interface LineChartGeometry {
  width: number
  height: number
  plot: { x: number; y: number; width: number; height: number }
  xScale: LinearScale
  yScale: LinearScale
  xTicks: Array<{ value: number; x: number; label: string }>
  yTicks: Array<{ value: number; y: number; label: string }>
  series: Array<{
    name: string
    color: string
    points: Array<{ value: number | null; x: number; px: number; py: number | null }>
    path: string
    areaPath: string
  }>
}

export const DEFAULT_PALETTE: string[]
export function lineChart(series?: LineSeriesInput[], options?: LineChartOptions): LineChartGeometry
export function lineChartSvg(series?: LineSeriesInput[], options?: LineChartOptions): string
