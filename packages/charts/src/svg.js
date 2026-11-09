import { sparkline } from './sparkline.js'
import { lineChart, DEFAULT_PALETTE } from './line.js'
import { areaChart } from './area.js'
import { barChart } from './bar.js'
import { pieChart } from './pie.js'

// ---------------------------------------------------------------------------
// Shared helpers
//
// Theming (all optional CSS custom properties, set them on any ancestor):
//   --tylix-chart-1 … --tylix-chart-5   series colors
//   --tylix-chart-bg                    surface color (rings around dots)
// Text and gridlines use currentColor, so they follow your text color.
// ---------------------------------------------------------------------------

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const fmt = (n) => Math.round(n * 100) / 100
const BG = 'var(--tylix-chart-bg, #fff)'
const CHAR_W = 6.2

let uid = 0
const nextId = () => `tc${++uid}`

const open = (id, w, h, label, kind) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="tylix-chart tylix-chart--${kind} ${id}" ` +
  `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(label)}" ` +
  `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11">`

const MUTED = 'fill="currentColor" fill-opacity="0.6"'

function seriesMeta(series = []) {
  return series.map((s, i) => ({
    name: s.name ?? `Series ${i + 1}`,
    color: s.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
  }))
}

function legendLayout(items, maxWidth) {
  const rows = []
  let row = []
  let x = 0
  for (const it of items) {
    const w = 16 + String(it.name).length * CHAR_W + 14
    if (row.length && x + w > maxWidth) {
      rows.push(row)
      row = []
      x = 0
    }
    row.push({ ...it, x, w })
    x += w
  }
  if (row.length) rows.push(row)
  return { rows, height: rows.length * 18 }
}

function legendMarkup(layout, x0, y0) {
  let out = ''
  layout.rows.forEach((row, r) => {
    const cy = y0 + r * 18 + 9
    for (const it of row) {
      out +=
        `<rect x="${fmt(x0 + it.x)}" y="${fmt(cy - 5)}" width="10" height="10" rx="3" fill="${escapeXml(it.color)}"/>` +
        `<text x="${fmt(x0 + it.x + 16)}" y="${fmt(cy)}" dominant-baseline="middle" fill="currentColor" fill-opacity="0.75">${escapeXml(it.name)}</text>`
    }
  })
  return out
}

// Reserves room above the plot for a legend (default: shown for 2+ series).
function planLegend(options, items) {
  const show = options.legend ?? items.length > 1
  if (!show || !items.length) return { layout: null, options }
  const layout = legendLayout(items, (options.width ?? 480) - 24)
  const top = (options.margin?.top ?? 12) + layout.height + 6
  return { layout, options: { ...options, margin: { ...options.margin, top } } }
}

function gridlines(ticks, plot, horizontalLines) {
  let out = ''
  for (const t of ticks) {
    const zero = t.value === 0
    const stroke = zero
      ? 'stroke="currentColor" stroke-opacity="0.3"'
      : 'stroke="currentColor" stroke-opacity="0.1" stroke-dasharray="3 4"'
    if (horizontalLines) {
      const y = t.y ?? t.pos
      out +=
        `<line x1="${plot.x}" x2="${plot.x + plot.width}" y1="${fmt(y)}" y2="${fmt(y)}" ${stroke}/>` +
        `<text x="${plot.x - 8}" y="${fmt(y)}" text-anchor="end" dominant-baseline="middle" ${MUTED}>${escapeXml(t.label)}</text>`
    } else {
      const x = t.pos
      out +=
        `<line x1="${fmt(x)}" x2="${fmt(x)}" y1="${plot.y}" y2="${plot.y + plot.height}" ${stroke}/>` +
        `<text x="${fmt(x)}" y="${plot.y + plot.height + 16}" text-anchor="middle" ${MUTED}>${escapeXml(t.label)}</text>`
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/** Renders a sparkline as an SVG string. Colors inherit via currentColor. */
export function sparklineSvg(data, options = {}) {
  const s = sparkline(data, options)
  const { showLastPoint = true, label = 'Sparkline' } = options
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}" viewBox="0 0 ${s.width} ${s.height}" role="img" aria-label="${escapeXml(label)}">`,
  ]
  if (s.areaPath) {
    parts.push(`<path d="${s.areaPath}" fill="currentColor" fill-opacity="0.12" stroke="none"/>`)
  }
  if (s.path) {
    parts.push(
      `<path d="${s.path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }
  if (showLastPoint && s.last) {
    parts.push(`<circle cx="${fmt(s.last.x)}" cy="${fmt(s.last.y)}" r="2" fill="currentColor"/>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Line + area (shared renderer)
// ---------------------------------------------------------------------------

function xyChartSvg(c, o) {
  const { id, label, kind, fill, dots, formatX, formatY, layout, interactive } = o
  const { plot } = c
  const stacked = !!c.stacked
  const out = [open(id, c.width, c.height, label, kind)]

  if (interactive && dots === 'hover') {
    out.push(
      `<style>.${id} .tc-pt .tc-dot{opacity:0;transition:opacity .12s}.${id} .tc-pt:hover .tc-dot{opacity:1}</style>`
    )
  }

  if (fill && !stacked) {
    out.push('<defs>')
    c.series.forEach((s, i) => {
      out.push(
        `<linearGradient id="${id}-g${i}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" style="stop-color:${escapeXml(s.color)};stop-opacity:0.32"/>` +
          `<stop offset="1" style="stop-color:${escapeXml(s.color)};stop-opacity:0.02"/></linearGradient>`
      )
    })
    out.push('</defs>')
  }

  if (layout) out.push(legendMarkup(layout, plot.x, 4))

  out.push(gridlines(c.yTicks, plot, true))
  for (const t of c.xTicks) {
    out.push(
      `<text x="${fmt(t.x)}" y="${plot.y + plot.height + 16}" text-anchor="middle" ${MUTED}>${escapeXml(t.label)}</text>`
    )
  }

  c.series.forEach((s, i) => {
    if (fill && s.areaPath) {
      const paint = stacked
        ? `fill="${escapeXml(s.color)}" fill-opacity="0.8"`
        : `fill="url(#${id}-g${i})"`
      out.push(`<path d="${s.areaPath}" ${paint} stroke="none"/>`)
    }
    if (s.path) {
      out.push(
        `<path d="${s.path}" fill="none" stroke="${escapeXml(s.color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    }
  })

  if (dots !== 'none') {
    c.series.forEach((s) => {
      const color = escapeXml(s.color)
      let lastIdx = -1
      s.points.forEach((p, k) => {
        if (p.py !== null) lastIdx = k
      })
      s.points.forEach((p, k) => {
        if (p.py === null) return
        const tip = `<title>${escapeXml(`${s.name} · ${formatX(p.x)}: ${formatY(p.value ?? 0)}`)}</title>`
        const dot = `fill="${color}" stroke="${BG}" stroke-width="2"`
        if (dots === 'all' || (k === lastIdx && !stacked)) {
          out.push(`<circle cx="${fmt(p.px)}" cy="${fmt(p.py)}" r="4" ${dot}>${tip}</circle>`)
        } else if (interactive && p.value !== null) {
          out.push(
            `<g class="tc-pt"><circle cx="${fmt(p.px)}" cy="${fmt(p.py)}" r="9" fill="transparent"/>` +
              `<circle class="tc-dot" cx="${fmt(p.px)}" cy="${fmt(p.py)}" r="4" ${dot}/>${tip}</g>`
          )
        }
      })
    })
  }

  out.push('</svg>')
  return out.join('')
}

/**
 * Renders a line chart as an SVG string.
 * Extra options: id, legend (default: 2+ series), dots ('hover' | 'all' | 'none'),
 * interactive (hover tooltips + dots, default true).
 */
export function lineChartSvg(series, options = {}) {
  const id = options.id ?? nextId()
  const plan = planLegend(options, seriesMeta(series))
  const c = lineChart(series, plan.options)
  return xyChartSvg(c, {
    id,
    kind: 'line',
    label: options.label ?? 'Line chart',
    fill: !!options.area,
    dots: options.dots ?? 'hover',
    formatX: options.formatX ?? ((v) => String(v)),
    formatY: options.formatY ?? ((v) => String(v)),
    layout: plan.layout,
    interactive: options.interactive ?? true,
  })
}

/** Renders an area chart (optionally stacked) as an SVG string. Same extras as lineChartSvg. */
export function areaChartSvg(series, options = {}) {
  const id = options.id ?? nextId()
  const plan = planLegend(options, seriesMeta(series))
  const c = areaChart(series, plan.options)
  return xyChartSvg(c, {
    id,
    kind: 'area',
    label: options.label ?? 'Area chart',
    fill: true,
    dots: options.dots ?? 'hover',
    formatX: options.formatX ?? ((v) => String(v)),
    formatY: options.formatY ?? ((v) => String(v)),
    layout: plan.layout,
    interactive: options.interactive ?? true,
  })
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

/**
 * Renders a bar chart as an SVG string.
 * Extra options: id, legend, interactive, valueLabels (print values on bars, not stacked).
 */
export function barChartSvg(series, options = {}) {
  const id = options.id ?? nextId()
  const { label = 'Bar chart', valueLabels = false, interactive = true } = options
  const plan = planLegend(options, seriesMeta(series))
  const c = barChart(series, plan.options)
  const { plot } = c
  const horizontal = c.orientation === 'horizontal'
  const out = [open(id, c.width, c.height, label, 'bar')]

  if (interactive) {
    out.push(
      `<style>.${id} .tc-bar{opacity:.9;transition:opacity .15s}.${id} .tc-bar:hover{opacity:1}</style>`
    )
  }
  if (plan.layout) out.push(legendMarkup(plan.layout, plot.x, 4))

  out.push(gridlines(c.valueTicks, plot, !horizontal))

  // baseline (zero line)
  out.push(
    horizontal
      ? `<line x1="${fmt(c.baseline)}" x2="${fmt(c.baseline)}" y1="${plot.y}" y2="${plot.y + plot.height}" stroke="currentColor" stroke-opacity="0.3"/>`
      : `<line x1="${plot.x}" x2="${plot.x + plot.width}" y1="${fmt(c.baseline)}" y2="${fmt(c.baseline)}" stroke="currentColor" stroke-opacity="0.3"/>`
  )

  // category labels (skip some when they would collide)
  const step = c.categoryScale.step()
  const longest = Math.max(1, ...c.categoryTicks.map((t) => t.label.length))
  const skip = horizontal ? 1 : Math.max(1, Math.ceil((longest * CHAR_W + 6) / (step || 1)))
  c.categoryTicks.forEach((t, i) => {
    if (i % skip !== 0) return
    out.push(
      horizontal
        ? `<text x="${plot.x - 8}" y="${fmt(t.pos)}" text-anchor="end" dominant-baseline="middle" ${MUTED}>${escapeXml(t.label)}</text>`
        : `<text x="${fmt(t.pos)}" y="${plot.y + plot.height + 16}" text-anchor="middle" ${MUTED}>${escapeXml(t.label)}</text>`
    )
  })

  const single = c.series.length === 1
  for (const s of c.series) {
    for (const b of s.bars) {
      if (!b.path) continue
      const tip = single ? `${b.categoryLabel}: ${b.label}` : `${b.categoryLabel} · ${s.name}: ${b.label}`
      out.push(
        `<path class="tc-bar" d="${b.path}" fill="${escapeXml(s.color)}"><title>${escapeXml(tip)}</title></path>`
      )
      if (valueLabels && !c.stacked) {
        const neg = b.value < 0
        out.push(
          horizontal
            ? `<text x="${fmt(neg ? b.x - 6 : b.x + b.width + 6)}" y="${fmt(b.y + b.height / 2)}" text-anchor="${neg ? 'end' : 'start'}" dominant-baseline="middle" fill="currentColor" fill-opacity="0.8">${escapeXml(b.label)}</text>`
            : `<text x="${fmt(b.x + b.width / 2)}" y="${fmt(neg ? b.y + b.height + 12 : b.y - 5)}" text-anchor="middle" fill="currentColor" fill-opacity="0.8">${escapeXml(b.label)}</text>`
        )
      }
    }
  }

  out.push('</svg>')
  return out.join('')
}

// ---------------------------------------------------------------------------
// Pie / donut
// ---------------------------------------------------------------------------

function pieSvg(data, options, defaultInner, kind) {
  const id = options.id ?? nextId()
  const size = options.size ?? 220
  const legendMode = options.legend === undefined ? 'right' : options.legend
  const interactive = options.interactive ?? true
  const label = options.label ?? (kind === 'donut' ? 'Donut chart' : 'Pie chart')

  const g = pieChart(data, {
    innerRadius: defaultInner,
    ...options,
    width: size,
    height: size,
  })
  const items = g.slices.map((s) => ({ name: s.label, color: s.color, percent: s.percentLabel }))

  let W = size
  let H = size
  let chartX = 0
  let chartY = 0
  let legend = ''

  if (legendMode === 'right' && items.length) {
    const rowH = 24
    const longest = Math.max(...items.map((i) => String(i.name).length))
    const lw = Math.min(220, longest * CHAR_W + 16 + 44)
    W = size + 20 + lw
    H = Math.max(size, items.length * rowH)
    chartY = (H - size) / 2
    const y0 = (H - items.length * rowH) / 2
    const x0 = size + 20
    items.forEach((it, i) => {
      const cy = y0 + i * rowH + rowH / 2
      legend +=
        `<rect x="${x0}" y="${fmt(cy - 5)}" width="10" height="10" rx="3" fill="${escapeXml(it.color)}"/>` +
        `<text x="${x0 + 16}" y="${fmt(cy)}" dominant-baseline="middle" fill="currentColor" fill-opacity="0.85">${escapeXml(it.name)}</text>` +
        `<text x="${x0 + lw}" y="${fmt(cy)}" text-anchor="end" dominant-baseline="middle" ${MUTED}>${escapeXml(it.percent)}</text>`
    })
  } else if (legendMode === 'bottom' && items.length) {
    const layout = legendLayout(items, size)
    H = size + 8 + layout.height
    const rowW = (row) => row[row.length - 1].x + row[row.length - 1].w - 14
    layout.rows.forEach((row, r) => {
      const x0 = (W - rowW(row)) / 2
      legend += legendMarkup({ rows: [row.map((it) => ({ ...it }))], height: 18 }, x0, size + 8 + r * 18)
    })
  }

  const out = [open(id, fmt(W), fmt(H), label, kind)]
  if (interactive) {
    out.push(
      `<style>.${id} .tc-slice{transition:opacity .15s}.${id}:hover .tc-slice{opacity:.45}.${id} .tc-slice:hover{opacity:1}</style>`
    )
  }

  out.push(`<g transform="translate(${chartX},${fmt(chartY)})">`)
  if (g.total === 0) {
    out.push(
      `<circle cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt((g.outerRadius + g.innerRadius) / 2)}" fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-width="${fmt(Math.max(2, g.outerRadius - g.innerRadius))}"/>`
    )
  }
  for (const s of g.slices) {
    if (!s.path) continue
    out.push(
      `<path class="tc-slice" d="${s.path}" fill="${escapeXml(s.color)}" fill-rule="evenodd"><title>${escapeXml(`${s.label}: ${s.valueLabel} (${s.percentLabel})`)}</title></path>`
    )
  }

  // center text (donut only)
  const hole = g.innerRadius
  if (hole >= 34 && options.centerLabel !== false) {
    const big = options.centerLabel ?? (options.formatValue ?? String)(g.total)
    const sub = options.centerSubLabel === undefined ? 'Total' : options.centerSubLabel
    const fs = Math.max(14, Math.min(28, hole * 0.5))
    out.push(
      `<text x="${fmt(g.cx)}" y="${fmt(g.cy - (sub ? 4 : 0))}" text-anchor="middle" dominant-baseline="${sub ? 'auto' : 'middle'}" font-size="${fmt(fs)}" font-weight="600" fill="currentColor">${escapeXml(big)}</text>`
    )
    if (sub) {
      out.push(
        `<text x="${fmt(g.cx)}" y="${fmt(g.cy + 6)}" text-anchor="middle" dominant-baseline="hanging" ${MUTED}>${escapeXml(sub)}</text>`
      )
    }
  }
  out.push('</g>')
  out.push(legend)
  out.push('</svg>')
  return out.join('')
}

/**
 * Renders a pie chart as an SVG string.
 * options: size (px, default 220), legend ('right' | 'bottom' | false), id, interactive,
 * plus every pieChart() option (cornerRadius, gap, startAngle, sort, innerRadius …).
 */
export function pieChartSvg(data, options = {}) {
  return pieSvg(data, options, 0, 'pie')
}

/**
 * Renders a donut chart as an SVG string. Adds centerLabel / centerSubLabel
 * (defaults: the total and "Total"; pass false to hide).
 */
export function donutChartSvg(data, options = {}) {
  return pieSvg(data, options, 0.62, 'donut')
}
