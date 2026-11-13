const fmt = (n) => Math.round(n * 100) / 100
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const BG = 'var(--tylix-chart-bg, #fff)'

/** Sorted, de-duplicated pixel x positions that hold at least one point. */
export function snapPositions(chart) {
  const xs = []
  for (const s of chart.series) for (const p of s.points) if (p.py !== null) xs.push(p.px)
  xs.sort((a, b) => a - b)
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.01)
}

/**
 * Finds the data position nearest to pixel x on a lineChart() / areaChart()
 * geometry. Returns null when the chart has no points.
 *   { index, px, x, rows: [{ name, color, value, x, px, py }] }
 */
export function nearestPoints(chart, px) {
  const xs = snapPositions(chart)
  if (!xs.length) return null
  let index = 0
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - px) < Math.abs(xs[index] - px)) index = i
  }
  const at = xs[index]
  const rows = []
  for (const s of chart.series) {
    const p = s.points.find((q) => q.py !== null && Math.abs(q.px - at) < 0.01)
    if (p) rows.push({ name: s.name, color: s.color, value: p.value, x: p.x, px: p.px, py: p.py })
  }
  return { index, px: at, x: rows[0]?.x ?? 0, rows }
}

/**
 * Adds a hover / touch / keyboard crosshair to an SVG made from a
 * lineChart() or areaChart() geometry (pass the same geometry you rendered).
 *
 *   const { destroy } = attachCrosshair(svgEl, chart, { formatY: (v) => `KES ${v}` })
 *
 * options:
 *   formatX, formatY  - tooltip formatting
 *   tooltip           - draw the built-in SVG tooltip (default true)
 *   onChange(state)   - called with nearestPoints() result, or null on leave;
 *                       use it with tooltip:false to render your own tooltip
 * Returns { show(px), hide(), destroy() }. Browser only.
 */
export function attachCrosshair(svg, chart, options = {}) {
  const {
    formatX = chart.formatX ?? ((v) => String(v)),
    formatY = (v) => String(v),
    tooltip = true,
    onChange,
  } = options
  const { plot } = chart
  const NS = 'http://www.w3.org/2000/svg'
  const g = document.createElementNS(NS, 'g')
  g.setAttribute('class', 'tylix-crosshair')
  g.setAttribute('pointer-events', 'none')
  g.style.display = 'none'
  svg.appendChild(g)
  svg.style.touchAction = 'pan-y'
  if (!svg.hasAttribute('tabindex')) svg.setAttribute('tabindex', '0')

  let current = null

  function draw(state) {
    let out =
      `<line x1="${fmt(state.px)}" x2="${fmt(state.px)}" y1="${plot.y}" y2="${plot.y + plot.height}" ` +
      `stroke="currentColor" stroke-opacity="0.25" stroke-dasharray="3 3"/>`
    for (const r of state.rows) {
      out += `<circle cx="${fmt(r.px)}" cy="${fmt(r.py)}" r="4.5" fill="${esc(r.color)}" stroke="${BG}" stroke-width="2"/>`
    }
    if (tooltip && state.rows.length) {
      const head = formatX(state.x)
      const lines = state.rows.map((r) => ({
        color: r.color,
        name: r.name,
        value: r.value === null ? '–' : formatY(r.value),
      }))
      const chars = Math.max(
        String(head).length,
        ...lines.map((l) => l.name.length + String(l.value).length + 3)
      )
      const w = Math.ceil(chars * 6.2 + 28)
      const h = 26 + lines.length * 16
      let tx = state.px + 12
      if (tx + w > chart.width - 4) tx = state.px - 12 - w
      tx = Math.max(4, tx)
      const ty = plot.y + 4
      out +=
        `<g transform="translate(${fmt(tx)},${fmt(ty)})">` +
        `<rect width="${w}" height="${h}" rx="6" fill="${BG}" stroke="currentColor" stroke-opacity="0.18"/>` +
        `<text x="10" y="16" font-size="11" font-weight="600" fill="currentColor">${esc(head)}</text>`
      lines.forEach((l, i) => {
        const y = 16 + (i + 1) * 16
        out +=
          `<circle cx="14" cy="${y - 4}" r="3.5" fill="${esc(l.color)}"/>` +
          `<text x="24" y="${y}" font-size="11" fill="currentColor" fill-opacity="0.7">${esc(l.name)}</text>` +
          `<text x="${w - 10}" y="${y}" font-size="11" text-anchor="end" font-weight="600" fill="currentColor">${esc(l.value)}</text>`
      })
      out += '</g>'
    }
    g.innerHTML = out
  }

  function show(px) {
    const state = nearestPoints(chart, px)
    if (!state) return hide()
    current = state
    g.style.display = ''
    draw(state)
    onChange?.(state)
  }

  function hide() {
    if (!current) return
    current = null
    g.style.display = 'none'
    g.innerHTML = ''
    onChange?.(null)
  }

  const toUser = (e) => {
    const r = svg.getBoundingClientRect()
    return r.width ? ((e.clientX - r.left) * chart.width) / r.width : NaN
  }

  const onMove = (e) => {
    const x = toUser(e)
    if (x >= plot.x && x <= plot.x + plot.width) show(x)
    else hide()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') return hide()
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const xs = snapPositions(chart)
    if (!xs.length) return
    e.preventDefault()
    const i = current ? current.index + (e.key === 'ArrowRight' ? 1 : -1) : e.key === 'ArrowRight' ? 0 : xs.length - 1
    show(xs[Math.min(xs.length - 1, Math.max(0, i))])
  }

  svg.addEventListener('pointermove', onMove)
  svg.addEventListener('pointerdown', onMove)
  svg.addEventListener('pointerleave', hide)
  svg.addEventListener('keydown', onKey)
  svg.addEventListener('blur', hide)

  return {
    show,
    hide,
    destroy() {
      svg.removeEventListener('pointermove', onMove)
      svg.removeEventListener('pointerdown', onMove)
      svg.removeEventListener('pointerleave', hide)
      svg.removeEventListener('keydown', onKey)
      svg.removeEventListener('blur', hide)
      g.remove()
    },
  }
}
