# @tylix/charts

Hand-rolled SVG charts for Tylix. No third-party dependencies.

## What's included

- `sparkline()` and `lineChart()` return plain geometry (paths, ticks,
  plot area) so a `.tyx` template can render them with `{{#each}}`
- `sparklineSvg()` and `lineChartSvg()` return finished SVG strings
- Building blocks: `linearScale`, `niceTicks`, `extent`, `linePath`, `areaPath`
- Gap support (`null` values break the line), `linear` and `step` curves,
  optional area fill, multiple series
- TypeScript declarations (`index.d.ts`)
- Themeable colors via `--tylix-chart-1` through `--tylix-chart-5`;
  sparklines inherit `currentColor`

## Usage

```js
import { sparkline, lineChart } from '@tylix/charts'

const s = sparkline([12, 18, 15, 30, 22], { width: 120, height: 32 })
// s.path, s.areaPath, s.last

const c = lineChart(
  [{ name: 'CPU', data: [10, 40, 30, 80] }],
  { width: 480, height: 240, formatY: (v) => `${v}%` }
)
// c.plot, c.xTicks, c.yTicks, c.series[0].path
```

Run the tests with `node --test`.

## License

MIT