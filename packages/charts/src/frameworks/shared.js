// What every framework wrapper does: props -> SVG string, and after
// mount, the interactive crosshair for line / area charts.
import { renderChart, chartGeometry } from '../svg.js'
import { attachCrosshair } from '../crosshair.js'

// The prop holding the data, per chart type.
export const DATA_PROP = {
  sparkline: 'data', line: 'series', area: 'series', bar: 'series', scatter: 'series',
  pie: 'data', donut: 'data', gauge: 'value', heatmap: 'data',
}

const WRAPPER_PROPS = new Set(['type', 'series', 'data', 'value', 'options', 'crosshair', 'class', 'className', 'style', 'children'])

// { type, series | data | value, options?, ...chart options } -> pieces
export function chartProps(props, type = props.type) {
  const options = { ...(props.options ?? {}) }
  for (const [k, v] of Object.entries(props)) if (!WRAPPER_PROPS.has(k) && v !== undefined) options[k] = v
  const data = props[DATA_PROP[type]] ?? props.data ?? props.series ?? props.value
  const interactive = props.crosshair !== false && (type === 'line' || type === 'area') && options.interactive !== false
  return { type, data, options, interactive }
}

export function svgFor({ type, data, options, interactive }, id) {
  // With the crosshair, the static per-point tooltips are not needed.
  return renderChart(type, data, { id, ...options, ...(interactive ? { interactive: false } : {}) })
}

// Returns a cleanup function.
export function enhance(host, { type, data, options, interactive }, id) {
  if (!interactive || !host || typeof document === 'undefined') return () => {}
  const svg = host.querySelector('svg')
  if (!svg) return () => {}
  const handle = attachCrosshair(svg, chartGeometry(type, data, { id, ...options }), options)
  return () => handle.destroy()
}

export const cleanId = (id) => `tc${String(id).replace(/[^A-Za-z0-9_-]/g, '')}`
