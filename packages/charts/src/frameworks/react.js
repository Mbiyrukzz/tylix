// React wrappers. Plain createElement, so no JSX build step is needed.
//
//   import { LineChart, BarChart, Gauge } from '@tylix/charts/react'
//   <LineChart series={series} height={260} formatY={(v) => `${v}%`} />
//   <Chart type="heatmap" data={days} />
import { createElement, useEffect, useId, useMemo, useRef } from 'react'
import { chartProps, cleanId, enhance, svgFor } from './shared.js'

export function Chart(props) {
  const ref = useRef(null)
  const reactId = useId() // stable between server render and hydration
  const id = props.id ?? cleanId(reactId)
  const spec = chartProps(props)
  const svg = svgFor(spec, id)
  useEffect(() => enhance(ref.current, spec, id), [svg])
  return createElement('div', {
    ref,
    className: ['tylix-chart-host', props.className ?? props.class].filter(Boolean).join(' '),
    style: props.style,
    dangerouslySetInnerHTML: { __html: svg },
  })
}

const named = (type) => {
  const C = (props) => createElement(Chart, { ...props, type })
  C.displayName = `${type[0].toUpperCase()}${type.slice(1)}Chart`
  return C
}

export const Sparkline = named('sparkline')
export const LineChart = named('line')
export const AreaChart = named('area')
export const BarChart = named('bar')
export const PieChart = named('pie')
export const DonutChart = named('donut')
export const ScatterChart = named('scatter')
export const Gauge = named('gauge')
export const Heatmap = named('heatmap')
