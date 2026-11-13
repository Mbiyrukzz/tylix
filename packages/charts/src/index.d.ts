// ---------------------------------------------------------------- scales & ticks
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

export interface BandScale<T = unknown> {
  (value: T): number | undefined
  bandwidth(): number
  step(): number
  center(value: T): number | undefined
  domain(): T[]
  range(): [number, number]
}

export function bandScale<T = unknown>(options?: {
  domain?: T[]
  range?: [number, number]
  padding?: number
  paddingInner?: number
  paddingOuter?: number
}): BandScale<T>

export function niceTicks(min: number, max: number, count?: number): number[]
export function extent(values: Iterable<unknown>): [number, number] | null

// ---------------------------------------------------------------- paths
export interface PixelPoint {
  x: number | null
  y: number | null
}
export interface BandPoint extends PixelPoint {
  /** Bottom edge (pixel y) of the band at this x. */
  y0: number | null
}
/** 'smooth' is a monotone cubic: it never overshoots the data. */
export type Curve = 'linear' | 'step' | 'smooth'

export function segments<T extends PixelPoint>(points: Array<T | null>): T[][]
export function linePath(points: Array<PixelPoint | null>, options?: { curve?: Curve }): string
export function areaPath(
  points: Array<PixelPoint | null>,
  baselineY: number,
  options?: { curve?: Curve }
): string
export function bandPath(points: Array<BandPoint | null>, options?: { curve?: Curve }): string

// ---------------------------------------------------------------- shared
export const DEFAULT_PALETTE: string[]

export interface Margin {
  top: number
  right: number
  bottom: number
  left: number
}

/** Options accepted by every *Svg() renderer. */
export interface SvgOptions {
  /** Accessible name (aria-label). */
  label?: string
  /** Stable id for the generated gradients / scoped styles (set it for SSR + hydration). */
  id?: string
  /** Hover tooltips, hover dots and hover highlight. Default true. */
  interactive?: boolean
}

// ---------------------------------------------------------------- sparkline
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

// ---------------------------------------------------------------- line
export interface LineSeriesInput {
  name?: string
  color?: string
  /** x may be a Date: the chart then gets a time axis. */
  data: Array<number | null | { x?: number | Date; y: number | null }>
}

export interface LineChartOptions {
  width?: number
  height?: number
  margin?: Partial<Margin>
  xDomain?: [number, number]
  yDomain?: [number, number]
  xTicks?: number
  yTicks?: number
  curve?: Curve
  area?: boolean
  zeroBaseline?: boolean
  /** With Date x values this receives a Date. Default: String, or a date format for time axes. */
  formatX?: (value: any) => string
  formatY?: (value: number) => string
  label?: string
  /** Time axes: 'UTC' (default), 'local', or an IANA zone like 'Europe/Paris'. */
  timeZone?: string
  /** Time axes: Intl locale for labels. Default 'en-US'. */
  locale?: string
}

export interface XYTick {
  value: number
  label: string
}

export interface LineChartGeometry {
  width: number
  height: number
  plot: { x: number; y: number; width: number; height: number }
  xScale: LinearScale
  yScale: LinearScale
  /** true when x values are Dates (plotted as milliseconds). */
  time: boolean
  /** Formats an x value for tooltips (dates for time axes). */
  formatX: (value: number) => string
  xTicks: Array<XYTick & { x: number }>
  yTicks: Array<XYTick & { y: number }>
  series: Array<{
    name: string
    color: string
    points: Array<{ value: number | null; x: number; px: number; py: number | null }>
    path: string
    areaPath: string
  }>
}

export interface LineChartSvgOptions extends LineChartOptions, SvgOptions {
  /** Default: shown when there are 2+ series. */
  legend?: boolean
  /** 'hover' (default): dot appears on hover. 'all': always. 'none': no dots, no tooltips. */
  dots?: 'hover' | 'all' | 'none'
}

export function lineChart(series?: LineSeriesInput[], options?: LineChartOptions): LineChartGeometry
export function lineChartSvg(series?: LineSeriesInput[], options?: LineChartSvgOptions): string

// ---------------------------------------------------------------- area
export interface AreaChartOptions extends Omit<LineChartOptions, 'area'> {
  /** Sum series per x position (index-aligned, null counts as 0, values >= 0). */
  stacked?: boolean
}

export interface AreaChartGeometry extends Omit<LineChartGeometry, 'series'> {
  stacked: boolean
  series: Array<{
    name: string
    color: string
    points: Array<{
      value: number | null
      x: number
      px: number
      py: number | null
      /** Lower edge of the band (baseline, or the series below when stacked). */
      py0: number
    }>
    path: string
    areaPath: string
  }>
}

export interface AreaChartSvgOptions extends AreaChartOptions, SvgOptions {
  legend?: boolean
  dots?: 'hover' | 'all' | 'none'
}

export function areaChart(series?: LineSeriesInput[], options?: AreaChartOptions): AreaChartGeometry
export function areaChartSvg(series?: LineSeriesInput[], options?: AreaChartSvgOptions): string

// ---------------------------------------------------------------- bar
export interface BarSeriesInput {
  name?: string
  color?: string
  data: Array<number | null>
}

export interface BarChartOptions {
  /** Labels along the category axis. Defaults to "1", "2", … */
  categories?: unknown[]
  orientation?: 'vertical' | 'horizontal'
  stacked?: boolean
  width?: number
  height?: number
  margin?: Partial<Margin>
  yDomain?: [number, number]
  yTicks?: number
  /** Include 0 in the value domain. Default true. */
  zeroBaseline?: boolean
  /** Space between categories, 0..1. Default 0.3. */
  padding?: number
  /** Space between bars inside a group, 0..1. Default 0.08. */
  groupPadding?: number
  /** Corner radius of the outer end of each bar, px. Default 4. */
  radius?: number
  formatValue?: (value: number) => string
  formatCategory?: (category: unknown) => string
  label?: string
}

export interface Bar {
  index: number
  category: unknown
  categoryLabel: string
  value: number | null
  label: string
  x: number
  y: number
  width: number
  height: number
  /** Empty string when the value is null or 0. */
  path: string
}

export interface BarChartGeometry {
  width: number
  height: number
  plot: { x: number; y: number; width: number; height: number }
  orientation: 'vertical' | 'horizontal'
  stacked: boolean
  /** Pixel position of the zero line along the value axis. */
  baseline: number
  valueScale: LinearScale
  categoryScale: BandScale<number>
  /** `pos` is y for vertical charts, x for horizontal ones. */
  valueTicks: Array<{ value: number; pos: number; label: string }>
  categoryTicks: Array<{ index: number; label: string; pos: number }>
  series: Array<{ name: string; color: string; bars: Bar[] }>
}

export interface BarChartSvgOptions extends BarChartOptions, SvgOptions {
  legend?: boolean
  /** Print the value next to each bar (grouped charts only). */
  valueLabels?: boolean
}

export function roundedBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r?: number,
  side?: 'top' | 'bottom' | 'left' | 'right' | 'none'
): string
export function barChart(series?: BarSeriesInput[], options?: BarChartOptions): BarChartGeometry
export function barChartSvg(series?: BarSeriesInput[], options?: BarChartSvgOptions): string

// ---------------------------------------------------------------- pie / donut
export interface PieDatum {
  label?: string
  value: number
  color?: string
}

export interface PieChartOptions {
  width?: number
  height?: number
  /** 0..1, fraction of the outer radius. 0 = pie. donutChart() defaults to 0.62. */
  innerRadius?: number
  /** Rounded slice corners, px. Default 4. */
  cornerRadius?: number
  /** Gap between slices, px. Default 2. */
  gap?: number
  /** Degrees; 0 = 12 o'clock, clockwise. */
  startAngle?: number
  sort?: 'none' | 'desc' | 'asc'
  /** Free space around the chart, px. Default 4. */
  margin?: number
  formatValue?: (value: number) => string
  formatPercent?: (fraction: number) => string
}

export interface PieSlice {
  index: number
  label: string
  value: number
  valueLabel: string
  /** 0..1 */
  percent: number
  percentLabel: string
  color: string
  startAngle: number
  endAngle: number
  midAngle: number
  /** Empty string for zero-value slices. Render with fill-rule="evenodd". */
  path: string
  centroid: { x: number; y: number }
  /** A point just outside the slice, for external labels. */
  labelPoint: { x: number; y: number }
}

export interface PieChartGeometry {
  width: number
  height: number
  cx: number
  cy: number
  outerRadius: number
  innerRadius: number
  total: number
  slices: PieSlice[]
}

export interface PieChartSvgOptions extends Omit<PieChartOptions, 'width' | 'height'>, SvgOptions {
  /** Chart diameter box in px. Default 220. */
  size?: number
  /** Default 'right'. */
  legend?: 'right' | 'bottom' | false
  /** Donut only. Defaults to the formatted total; false hides it. */
  centerLabel?: string | false
  /** Donut only. Default "Total"; false or '' hides it. */
  centerSubLabel?: string | false
}

export function arcPath(options?: {
  cx?: number
  cy?: number
  innerRadius?: number
  outerRadius?: number
  startAngle?: number
  endAngle?: number
  cornerRadius?: number
}): string
export function pieChart(data?: Array<number | PieDatum>, options?: PieChartOptions): PieChartGeometry
export function donutChart(data?: Array<number | PieDatum>, options?: PieChartOptions): PieChartGeometry
export function pieChartSvg(data?: Array<number | PieDatum>, options?: PieChartSvgOptions): string
export function donutChartSvg(data?: Array<number | PieDatum>, options?: PieChartSvgOptions): string

// ---------------------------------------------------------------- crosshair
export interface CrosshairRow {
  name: string
  color: string
  value: number | null
  x: number
  px: number
  py: number
}

export interface CrosshairState {
  /** Position in the snap list. */
  index: number
  /** Pixel x of the snapped data position. */
  px: number
  /** Data x value. */
  x: number
  rows: CrosshairRow[]
}

export function snapPositions(chart: LineChartGeometry | AreaChartGeometry): number[]
export function nearestPoints(chart: LineChartGeometry | AreaChartGeometry, px: number): CrosshairState | null

export interface CrosshairOptions {
  formatX?: (value: number) => string
  formatY?: (value: number) => string
  /** Draw the built-in SVG tooltip. Default true. */
  tooltip?: boolean
  /** Called with the snapped state, or null when the pointer leaves. */
  onChange?: (state: CrosshairState | null) => void
}

/** Browser only. Pass the same geometry the SVG was rendered from. */
export function attachCrosshair(
  svg: SVGSVGElement,
  chart: LineChartGeometry | AreaChartGeometry,
  options?: CrosshairOptions
): { show(px: number): void; hide(): void; destroy(): void }

// ---------------------------------------------------------------- time

export type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
export interface TimeAxisOptions { timeZone?: string; locale?: string }
export function isTimeData(series: Array<{ data?: unknown[] }>): boolean
export function timeInterval(start: number, end: number, count?: number): { unit: TimeUnit; step: number }
export function timeTicks(start: number, end: number, count?: number, options?: TimeAxisOptions): { ticks: number[]; unit: TimeUnit; step: number }
export function timeFormatter(unit: TimeUnit, options?: TimeAxisOptions): (ms: number) => string
export function timeAxis(
  start: number | Date,
  end: number | Date,
  count?: number,
  options?: TimeAxisOptions,
): { ticks: { value: number; label: string }[]; unit: TimeUnit; step: number; format: (ms: number) => string; tooltip: (ms: number) => string }

// ------------------------------------------------------- scatter / bubble

export interface ScatterPointInput { x: number | Date; y: number; size?: number; label?: string }
export interface ScatterSeriesInput { name?: string; color?: string; data: ScatterPointInput[] }
export interface ScatterChartOptions {
  width?: number
  height?: number
  margin?: Partial<Margin>
  xDomain?: [number | Date, number | Date]
  yDomain?: [number, number]
  xTicks?: number
  yTicks?: number
  /** Bubble radius range for points with `size`. Default [4, 22]. */
  radius?: [number, number]
  /** Radius of points without `size`. Default 4.5. */
  pointRadius?: number
  formatX?: (value: any) => string
  formatY?: (value: number) => string
  timeZone?: string
  locale?: string
}
export interface ScatterPoint { x: number; y: number; size: number | null; label: string | null; px: number; py: number; r: number }
export interface ScatterChartGeometry {
  width: number
  height: number
  plot: { x: number; y: number; width: number; height: number }
  time: boolean
  formatX: (value: number) => string
  formatY: (value: number) => string
  xTicks: Array<XYTick & { x: number }>
  yTicks: Array<XYTick & { y: number }>
  series: Array<{ name: string; color: string; points: ScatterPoint[] }>
}
export function scatterChart(series?: ScatterSeriesInput[], options?: ScatterChartOptions): ScatterChartGeometry
export function nearestScatterPoint(chart: ScatterChartGeometry, px: number, py: number, max?: number): (ScatterPoint & { name: string; color: string }) | null
export function scatterChartSvg(series?: ScatterSeriesInput[], options?: ScatterChartOptions & SvgOptions): string

// ---------------------------------------------------------------- gauge

export interface GaugeOptions {
  min?: number
  max?: number
  size?: number
  /** Ring thickness as a share of the radius. Default 0.16. */
  thickness?: number
  /** Degrees from 12 o'clock, clockwise. Default -120 / 120. */
  startAngle?: number
  endAngle?: number
  cornerRadius?: number
  /** The value arc takes the colour of the band the value is in. */
  thresholds?: Array<{ value: number; color: string }>
  /** Draw the threshold bands outside the track. */
  bands?: boolean
  color?: string
  format?: (value: number) => string
}
export interface GaugeGeometry {
  size: number
  cx: number
  cy: number
  min: number
  max: number
  value: number
  percent: number
  angle: number
  color: string
  label: string
  track: string
  valuePath: string
  needle: { x: number; y: number }
  bands: Array<{ path: string; color: string }>
  bottom: number
}
export function gauge(value: number, options?: GaugeOptions): GaugeGeometry
export function gaugeSvg(value: number, options?: GaugeOptions & SvgOptions & { caption?: string; needle?: boolean; showMinMax?: boolean }): string

// ------------------------------------------------------ calendar heatmap

export type HeatmapInput = Array<{ date: string | Date; value: number }> | Record<string, number>
export interface CalendarHeatmapOptions {
  from?: string | Date
  to?: string | Date
  /** 0 = Sunday (default), 1 = Monday */
  weekStart?: 0 | 1
  cell?: number
  gap?: number
  levels?: number
  max?: number
  locale?: string
  labels?: boolean
}
export interface HeatmapCell { date: string; value: number; level: number; x: number; y: number }
export interface CalendarHeatmapGeometry {
  width: number
  height: number
  cell: number
  cells: HeatmapCell[]
  months: Array<{ label: string; x: number }>
  days: Array<{ label: string; y: number }>
  levels: number
  max: number
  total: number
}
export function calendarHeatmap(data?: HeatmapInput, options?: CalendarHeatmapOptions): CalendarHeatmapGeometry
export function calendarHeatmapSvg(
  data?: HeatmapInput,
  options?: CalendarHeatmapOptions & SvgOptions & { color?: string; formatValue?: (v: number) => string; legend?: boolean },
): string

// ------------------------------------------------------------ a11y

export function describeSeries(series: Array<{ name?: string; data?: unknown[]; points?: unknown[] }>, options?: { formatY?: (v: number) => string }): string
export function dataTable(
  series: Array<{ name?: string; data?: unknown[] }>,
  options?: { caption?: string; formatX?: (v: any) => string; formatY?: (v: number) => string; className?: string },
): string
export const SR_ONLY_STYLE: string

// --------------------------------------------------------- any chart

export type ChartType = 'sparkline' | 'line' | 'area' | 'bar' | 'pie' | 'donut' | 'scatter' | 'gauge' | 'heatmap'
export const CHART_TYPES: Record<ChartType, (data: any, options?: any) => string>
export function renderChart(type: ChartType, data: unknown, options?: Record<string, unknown>): string
export function chartGeometry(type: ChartType, data: unknown, options?: Record<string, unknown>): LineChartGeometry | AreaChartGeometry | null
