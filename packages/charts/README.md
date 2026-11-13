# @tylix/charts

SVG charts with no dependencies. Use them as `.tyx` components in Tylix
pages, as React, Vue or Svelte components, or as plain functions that
return SVG strings or geometry.

| Chart | Function | `.tyx` component |
| --- | --- | --- |
| Line (optionally filled) | `lineChart` / `lineChartSvg` | `<LineChart>` |
| Area, stacked area | `areaChart` / `areaChartSvg` | `<AreaChart>` |
| Bar: grouped, stacked, horizontal | `barChart` / `barChartSvg` | `<BarChart>` |
| Pie, donut | `pieChart`, `donutChart` / `…Svg` | `<PieChart>`, `<Donut>` |
| Scatter, bubble | `scatterChart` / `scatterChartSvg` | `<ScatterChart>` |
| Gauge | `gauge` / `gaugeSvg` | `<Gauge>` |
| Calendar heatmap | `calendarHeatmap` / `calendarHeatmapSvg` | `<Heatmap>` |
| Sparkline | `sparkline` / `sparklineSvg` | `<Sparkline>` |

All of them come with:

- **Time axes**: give points a `Date` as `x` and the axis ticks on whole hours, days, weeks, months or years. Labels and tooltips are formatted to match (UTC by default; `timeZone`, `locale`).
- **Tooltips**: an interactive crosshair for line and area charts (pointer and arrow keys), hover tooltips on scatter points and heatmap days, and `<title>` tooltips in the plain SVG output.
- **Legends**: shown automatically for two or more series. `legend: false` hides them.
- **Accessibility**: every SVG has a `<title>` and a plain-language `<desc>` ("1 series over 12 points. CPU: 10 to 80, last 64."). The components also include a visually hidden data table, and the gauge uses `role="meter"`.
- **Theming**: series colors come from `--tylix-chart-1` … `--tylix-chart-5`. Text and gridlines use `currentColor`, and `--tylix-chart-bg` sets the surface color.

```sh
npm install @tylix/charts
```

## In Tylix pages

```html
page Dashboard

import { LineChart, BarChart, Gauge, Heatmap, ScatterChart } from "@tylix/charts"

state
  visits: [{ name: "Visits", data: [] }]
  cpu: 62

template
  <LineChart label="Visits" series="{{ visits }}" height="{{ 260 }}" />
  <Gauge value="{{ cpu }}" caption="CPU" needle="{{ true }}"
         thresholds="{{ [{ value: 0, color: '#16a34a' }, { value: 80, color: '#dc2626' }] }}" />
  <Heatmap label="Commits" data="{{ commits }}" />
```

The components load the chart geometry from `/_tylix/charts/` (served by
`tylix dev` / `tylix start`) and render with Tailwind-aware dark mode.

## React

```jsx
import { LineChart, Gauge, Chart } from '@tylix/charts/react'

<LineChart series={series} height={260} formatY={(v) => `${v}%`} />
<Gauge value={72} caption="CPU" needle />
<Chart type="heatmap" data={days} />
```

## Vue

```vue
<script setup>
import { LineChart, BarChart } from '@tylix/charts/vue'
</script>

<template>
  <LineChart :series="series" :height="260" />
  <BarChart :series="sales" :categories="['Q1', 'Q2', 'Q3']" stacked />
</template>
```

## Svelte 5

```svelte
<script>
  import { Chart } from '@tylix/charts/svelte'
</script>

<Chart type="scatter" series={points} height={300} />
```

All three wrappers render the same SVG on the server and in the browser.
SVG ids come from the framework's own id helper, so hydration matches.
Line and area charts get the interactive crosshair once mounted. Chart
options can be passed as props or all together as `options={...}`.

## Angular and anything else

`renderChart(type, data, options)` returns an SVG string:

```ts
import { renderChart } from '@tylix/charts'

this.svg = this.sanitizer.bypassSecurityTrustHtml(
  renderChart('bar', this.series, { categories: this.quarters }),
)
// <div [innerHTML]="svg"></div>
```

For the line/area crosshair, call `attachCrosshair(svgElement, chartGeometry(type, data, options))`.

## Data shapes

```js
// line, area, bar
[{ name: 'CPU', color?: '#2563eb', data: [10, 40, null, 25] }]       // x = index, null = gap
[{ name: 'Visits', data: [{ x: new Date('2024-05-01'), y: 120 }] }]  // time axis

// scatter / bubble (size makes bubbles; radius grows with the square root)
[{ name: 'Plans', data: [{ x: 12, y: 40, size: 300, label: 'Pro' }] }]

// pie, donut
[{ label: 'Direct', value: 40 }, { label: 'Search', value: 25 }]

// gauge
gaugeSvg(72, { min: 0, max: 100, thresholds: [{ value: 0, color: 'green' }, { value: 80, color: 'red' }], bands: true, needle: true })

// calendar heatmap: an array or an object keyed by date
[{ date: '2024-05-01', value: 3 }]   or   { '2024-05-01': 3 }
calendarHeatmapSvg(days, { to: '2024-12-31', weekStart: 1, levels: 5 })
```

## Geometry only

Every `…Chart()` function returns plain geometry: paths, ticks, the plot
area and the points with their pixel positions. Render it however you
like, for example with `{{#each}}` in a template, in a canvas, or in a
PDF. The building blocks are exported too: `linearScale`, `bandScale`,
`niceTicks`, `extent`, `linePath`, `areaPath`, `arcPath`, `timeAxis`,
`timeTicks`, `nearestPoints`, `nearestScatterPoint`, `describeSeries`
and `dataTable`.

## License

MIT
