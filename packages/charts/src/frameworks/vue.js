// Vue 3 wrappers.
//
//   import { LineChart, Gauge } from '@tylix/charts/vue'
//   <LineChart :series="series" :height="260" />
//   <Chart type="heatmap" :data="days" />
import * as vue from 'vue'
import { chartProps, cleanId, enhance, svgFor } from './shared.js'

const { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } = vue
let counter = 0

function makeChart(fixedType) {
  return defineComponent({
    name: fixedType ? `${fixedType[0].toUpperCase()}${fixedType.slice(1)}Chart` : 'TylixChart',
    inheritAttrs: false,
    props: {
      type: String,
      series: Array,
      data: [Array, Object],
      value: Number,
      options: Object,
      crosshair: { type: Boolean, default: true },
      id: String,
    },
    setup(props, { attrs }) {
      const host = ref(null)
      // useId (Vue 3.5+) keeps server and client ids equal.
      const id = props.id ?? cleanId(typeof vue.useId === 'function' ? vue.useId() : `v${++counter}`)
      const spec = () => {
        const { class: cls, style, ...rest } = attrs
        return chartProps({ ...rest, ...props, type: fixedType ?? props.type })
      }
      let cleanup = () => {}
      const svg = () => svgFor(spec(), id)
      onMounted(() => {
        cleanup = enhance(host.value, spec(), id)
        watch(svg, () => {
          cleanup()
          // after the DOM update
          queueMicrotask(() => (cleanup = enhance(host.value, spec(), id)))
        })
      })
      onBeforeUnmount(() => cleanup())
      return () =>
        h('div', {
          ref: host,
          class: ['tylix-chart-host', attrs.class],
          style: attrs.style,
          innerHTML: svg(),
        })
    },
  })
}

export const Chart = makeChart(null)
export const Sparkline = makeChart('sparkline')
export const LineChart = makeChart('line')
export const AreaChart = makeChart('area')
export const BarChart = makeChart('bar')
export const PieChart = makeChart('pie')
export const DonutChart = makeChart('donut')
export const ScatterChart = makeChart('scatter')
export const Gauge = makeChart('gauge')
export const Heatmap = makeChart('heatmap')
