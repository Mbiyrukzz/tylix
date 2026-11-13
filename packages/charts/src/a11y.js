import { isDate } from './time.js'
// Screen-reader text for charts.

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * One-sentence summary of xy series: what is plotted and the range of
 * each series, e.g. "2 series over 12 points. Revenue: 10 to 80, last 64."
 */
export function describeSeries(series = [], { formatY = (v) => String(v) } = {}) {
  if (!series.length) return 'No data.'
  const parts = series.map((s) => {
    const ys = (s.points ?? s.bars ?? s.data ?? [])
      .map((p) => (typeof p === 'number' ? p : p?.value ?? p?.y))
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
    if (!ys.length) return `${s.name}: no values`
    return `${s.name}: ${formatY(Math.min(...ys))} to ${formatY(Math.max(...ys))}, last ${formatY(ys.at(-1))}`
  })
  const n = Math.max(...series.map((s) => (s.points ?? s.bars ?? s.data ?? []).length))
  return `${series.length} series over ${n} points. ${parts.join('. ')}.`
}

/**
 * An HTML <table> of xy series (one row per x, one column per series),
 * for a visually hidden alternative to the chart.
 *   dataTable([{ name: 'CPU', data: [...] }], { caption: 'CPU load', formatX, formatY })
 */
export function dataTable(series = [], { caption, formatX = (v) => String(v), formatY = (v) => String(v), className = 'tylix-chart-table' } = {}) {
  const rows = new Map()
  series.forEach((s, i) => {
    ;(s.data ?? []).forEach((d, k) => {
      const x = typeof d === 'number' || d == null ? k : isDate(d.x) ? d.x.getTime() : d.x ?? k
      const y = typeof d === 'number' ? d : d?.y ?? null
      if (!rows.has(x)) rows.set(x, [])
      rows.get(x)[i] = y
    })
  })
  const time = series.some((s) => (s.data ?? []).some((d) => isDate(d?.x)))
  const head = `<tr><th scope="col">${time ? 'Date' : 'x'}</th>${series.map((s, i) => `<th scope="col">${esc(s.name ?? `Series ${i + 1}`)}</th>`).join('')}</tr>`
  const body = [...rows.entries()]
    .sort((a, b) => (typeof a[0] === 'number' && typeof b[0] === 'number' ? a[0] - b[0] : 0))
    .map(([x, ys]) => `<tr><th scope="row">${esc(formatX(time ? new Date(x) : x))}</th>${series.map((_, i) => `<td>${ys[i] == null ? '' : esc(formatY(ys[i]))}</td>`).join('')}</tr>`)
    .join('')
  return `<table class="${esc(className)}">${caption ? `<caption>${esc(caption)}</caption>` : ''}<thead>${head}</thead><tbody>${body}</tbody></table>`
}

/** CSS that hides an element visually but keeps it for screen readers. */
export const SR_ONLY_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
