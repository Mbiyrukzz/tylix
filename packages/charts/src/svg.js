import { sparkline } from './sparkline.js'
import { lineChart, DEFAULT_PALETTE } from './line.js'
import { areaChart } from './area.js'
import { barChart } from './bar.js'
import { pieChart } from './pie.js'
import { scatterChart } from './scatter.js'
import { gauge } from './gauge.js'
import { calendarHeatmap } from './heatmap.js'
import { describeSeries } from './a11y.js'

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

// role="img" with a <title> and <desc>: screen readers announce the
// label and the plain-language summary.
const open = (id, w, h, label, kind, desc = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="tylix-chart tylix-chart--${kind} ${id}" ` +
  `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-t${desc ? ` ${id}-d` : ''}" ` +
  `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11">` +
  `<title id="${id}-t">${escapeXml(label)}</title>${desc ? `<desc id="${id}-d">${escapeXml(desc)}</desc>` : ''}`

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
        `<text x="${fmt(x)}" y="${plot.y + plot.height + 16}" text-anchor="${t.anchor ?? 'middle'}" ${MUTED}>${escapeXml(t.label)}</text>`
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
  const out = [open(id, c.width, c.height, label, kind, describeSeries(c.series, { formatY }))]

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
      `<text x="${fmt(t.x)}" y="${plot.y + plot.height + 16}" text-anchor="${t.anchor ?? 'middle'}" ${MUTED}>${escapeXml(t.label)}</text>`
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
    formatX: options.formatX ? (v) => options.formatX(c.time ? new Date(v) : v) : c.formatX,
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
    formatX: options.formatX ? (v) => options.formatX(c.time ? new Date(v) : v) : c.formatX,
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
  const out = [open(id, c.width, c.height, label, 'bar', describeSeries(c.series ?? [], { formatY: options.formatValue }))]

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
        : `<text x="${fmt(t.pos)}" y="${plot.y + plot.height + 16}" text-anchor="${t.anchor ?? 'middle'}" ${MUTED}>${escapeXml(t.label)}</text>`
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

  const out = [open(id, fmt(W), fmt(H), label, kind, g.slices.map((sl) => `${sl.label}: ${sl.valueLabel} (${sl.percentLabel})`).join(', '))]
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

// ---------------------------------------------------------------------------
// Scatter / bubble
// ---------------------------------------------------------------------------

/**
 * Renders a scatter (or bubble, with point `size`) chart as an SVG string.
 * Extra options: id, label, legend (default: 2+ series), interactive.
 */
export function scatterChartSvg(series, options = {}) {
  const id = options.id ?? nextId()
  const { label = 'Scatter chart', interactive = true } = options
  const plan = planLegend(options, seriesMeta(series))
  const c = scatterChart(series, plan.options)
  const { plot } = c
  const fx = options.formatX ? (v) => options.formatX(c.time ? new Date(v) : v) : c.formatX
  const out = [open(id, c.width, c.height, label, 'scatter', describeSeries(c.series.map((s) => ({ name: s.name, data: s.points.map((p) => p.y) })), { formatY: c.formatY }))]
  if (interactive) out.push(`<style>.${id} .tc-pt{transition:fill-opacity .12s}.${id} .tc-pt:hover{fill-opacity:.95}</style>`)
  if (plan.layout) out.push(legendMarkup(plan.layout, plot.x, 4))
  out.push(gridlines(c.yTicks, plot, true))
  for (const t of c.xTicks) {
    out.push(`<line x1="${fmt(t.x)}" x2="${fmt(t.x)}" y1="${plot.y}" y2="${plot.y + plot.height}" stroke="currentColor" stroke-opacity="0.08"/>`)
    out.push(`<text x="${fmt(t.x)}" y="${plot.y + plot.height + 16}" text-anchor="${t.anchor ?? 'middle'}" ${MUTED}>${escapeXml(t.label)}</text>`)
  }
  for (const s of c.series) {
    for (const p of s.points) {
      const tip = `${p.label ? `${p.label} · ` : ''}${s.name}: ${fx(p.x)}, ${c.formatY(p.y)}${p.size != null ? ` (${p.size})` : ''}`
      out.push(
        `<circle class="tc-pt" cx="${fmt(p.px)}" cy="${fmt(p.py)}" r="${fmt(p.r)}" fill="${escapeXml(s.color)}" fill-opacity="${p.size != null ? 0.55 : 0.85}" stroke="${escapeXml(s.color)}" stroke-width="1"><title>${escapeXml(tip)}</title></circle>`,
      )
    }
  }
  out.push('</svg>')
  return out.join('')
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/**
 * Renders a gauge as an SVG string.
 * options: everything gauge() takes, plus id, label, caption (text under
 * the value), needle (default false), showMinMax (default true).
 */
export function gaugeSvg(value, options = {}) {
  const id = options.id ?? nextId()
  const g = gauge(value, options)
  const { label = 'Gauge', caption = '', needle = false, showMinMax = true } = options
  const vy = needle ? g.cy + g.size * 0.22 : g.cy + 8
  const captionY = vy + g.size * 0.1
  const H = Math.ceil(Math.max(g.bottom + (showMinMax ? 18 : 6), (caption ? captionY : vy) + 8))
  const desc = `${g.label} of ${g.min} to ${g.max} (${Math.round(g.percent * 100)}%)${caption ? `, ${caption}` : ''}`
  const out = [open(id, g.size, H, label, 'gauge', desc)]
  for (const b of g.bands) out.push(`<path d="${b.path}" fill="${escapeXml(b.color)}" fill-opacity="0.5"/>`)
  out.push(`<path d="${g.track}" fill="currentColor" fill-opacity="0.1"/>`)
  if (g.valuePath) out.push(`<path d="${g.valuePath}" fill="${escapeXml(g.color)}"/>`)
  if (needle) {
    out.push(
      `<line x1="${g.cx}" y1="${g.cy}" x2="${fmt(g.needle.x)}" y2="${fmt(g.needle.y)}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>` +
        `<circle cx="${g.cx}" cy="${g.cy}" r="5" fill="currentColor"/>`,
    )
  }
  out.push(`<text x="${g.cx}" y="${fmt(vy)}" text-anchor="middle" font-size="${fmt(g.size * 0.16)}" font-weight="600" fill="currentColor">${escapeXml(g.label)}</text>`)
  if (caption) out.push(`<text x="${g.cx}" y="${fmt(captionY)}" text-anchor="middle" ${MUTED}>${escapeXml(caption)}</text>`)
  if (showMinMax) {
    const a0 = ((options.startAngle ?? -120) * Math.PI) / 180
    const a1 = ((options.endAngle ?? 120) * Math.PI) / 180
    const r = g.size / 2 - 2
    const at = (a) => ({ x: g.cx + r * 0.82 * Math.sin(a), y: Math.min(H - 4, g.cy - r * Math.cos(a) + 14) })
    const lo = at(a0)
    const hi = at(a1)
    out.push(`<text x="${fmt(lo.x)}" y="${fmt(lo.y)}" text-anchor="middle" ${MUTED}>${escapeXml(String(g.min))}</text>`)
    out.push(`<text x="${fmt(hi.x)}" y="${fmt(hi.y)}" text-anchor="middle" ${MUTED}>${escapeXml(String(g.max))}</text>`)
  }
  out.push('</svg>')
  return out.join('')
}

// ---------------------------------------------------------------------------
// Calendar heatmap
// ---------------------------------------------------------------------------

// Empty days use the text color faintly; levels 1+ step up the series color.
const levelFill = (level, levels, color) =>
  level === 0
    ? 'fill="currentColor" fill-opacity="0.08"'
    : `fill="${escapeXml(color)}" fill-opacity="${fmt(0.2 + (0.8 * level) / (levels - 1))}"`

/**
 * Renders a calendar heatmap as an SVG string.
 * options: everything calendarHeatmap() takes, plus id, label, color,
 * formatValue, legend (default true: a "Less … More" scale).
 */
export function calendarHeatmapSvg(data, options = {}) {
  const id = options.id ?? nextId()
  const h = calendarHeatmap(data, options)
  const { label = 'Calendar heatmap', color = 'var(--tylix-chart-1, #2563eb)', formatValue = (v) => String(v), legend = true } = options
  const H = h.height + (legend ? 24 : 0)
  const busiest = h.cells.reduce((a, c) => (c.value > (a?.value ?? 0) ? c : a), null)
  const desc = `${h.cells.length} days from ${h.cells[0]?.date} to ${h.cells.at(-1)?.date}. Total ${formatValue(h.total)}${busiest ? `, highest ${formatValue(busiest.value)} on ${busiest.date}` : ''}.`
  const out = [open(id, h.width, H, label, 'heatmap', desc)]
  for (const m of h.months) out.push(`<text x="${m.x}" y="10" ${MUTED}>${escapeXml(m.label)}</text>`)
  for (const d of h.days) out.push(`<text x="0" y="${fmt(d.y)}" dominant-baseline="middle" ${MUTED}>${escapeXml(d.label)}</text>`)
  for (const c of h.cells) {
    out.push(
      `<rect x="${c.x}" y="${c.y}" width="${h.cell}" height="${h.cell}" rx="2" ${levelFill(c.level, h.levels, color)}><title>${escapeXml(`${c.date}: ${formatValue(c.value)}`)}</title></rect>`,
    )
  }
  if (legend) {
    const y = h.height + 10
    let x = h.width - h.levels * (h.cell + 3) - 34
    out.push(`<text x="${x - 6}" y="${y + h.cell - 2}" text-anchor="end" ${MUTED}>Less</text>`)
    for (let l = 0; l < h.levels; l++) {
      out.push(`<rect x="${x}" y="${y}" width="${h.cell}" height="${h.cell}" rx="2" ${levelFill(l, h.levels, color)}/>`)
      x += h.cell + 3
    }
    out.push(`<text x="${x + 3}" y="${y + h.cell - 2}" ${MUTED}>More</text>`)
  }
  out.push('</svg>')
  return out.join('')
}

// ---------------------------------------------------------------------------
// One entry point for every chart type (used by the React / Vue / Svelte
// wrappers, and handy anywhere a string of SVG is wanted).
// ---------------------------------------------------------------------------

export const CHART_TYPES = {
  sparkline: sparklineSvg,
  line: lineChartSvg,
  area: areaChartSvg,
  bar: barChartSvg,
  pie: pieChartSvg,
  donut: donutChartSvg,
  scatter: scatterChartSvg,
  gauge: gaugeSvg,
  heatmap: calendarHeatmapSvg,
}

/**
 * renderChart('line', series, options) -> SVG string.
 * data is: series for line / area / bar / scatter, slices for pie /
 * donut, numbers for sparkline, a number for gauge, days for heatmap.
 */
export function renderChart(type, data, options = {}) {
  const render = CHART_TYPES[type]
  if (!render) throw new Error(`Unknown chart type "${type}". Use ${Object.keys(CHART_TYPES).join(', ')}.`)
  return render(data, options)
}

/**
 * The geometry a line / area SVG was drawn from (same legend spacing),
 * for attachCrosshair() on the rendered <svg>. null for other types.
 */
export function chartGeometry(type, data, options = {}) {
  if (type !== 'line' && type !== 'area') return null
  const plan = planLegend(options, seriesMeta(data))
  return type === 'line' ? lineChart(data, plan.options) : areaChart(data, plan.options)
}
