import { sparkline } from './sparkline.js'
import { lineChart } from './line.js'

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

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
    parts.push(`<circle cx="${s.last.x}" cy="${s.last.y}" r="2" fill="currentColor"/>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

/** Renders a line chart (axes, gridlines, series) as an SVG string. */
export function lineChartSvg(series, options = {}) {
  const c = lineChart(series, options)
  const { label = 'Line chart' } = options
  const { plot } = c
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" role="img" aria-label="${escapeXml(label)}" font-family="system-ui, sans-serif" font-size="11">`,
  ]

  // Gridlines + y labels
  for (const t of c.yTicks) {
    parts.push(
      `<line x1="${plot.x}" x2="${plot.x + plot.width}" y1="${t.y}" y2="${t.y}" stroke="currentColor" stroke-opacity="0.12"/>`,
      `<text x="${plot.x - 6}" y="${t.y}" text-anchor="end" dominant-baseline="middle" fill="currentColor" fill-opacity="0.65">${escapeXml(t.label)}</text>`
    )
  }

  // x labels
  for (const t of c.xTicks) {
    parts.push(
      `<text x="${t.x}" y="${plot.y + plot.height + 16}" text-anchor="middle" fill="currentColor" fill-opacity="0.65">${escapeXml(t.label)}</text>`
    )
  }

  // Series
  for (const s of c.series) {
    if (s.areaPath) {
      parts.push(`<path d="${s.areaPath}" fill="${s.color}" fill-opacity="0.12" stroke="none"/>`)
    }
    if (s.path) {
      parts.push(
        `<path d="${s.path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    }
  }

  parts.push('</svg>')
  return parts.join('')
}
