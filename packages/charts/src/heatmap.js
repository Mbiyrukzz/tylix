/**
 * Calendar heatmap geometry: one cell per day, columns are weeks.
 *
 *   calendarHeatmap([{ date: '2024-05-01', value: 3 }, ...])
 *   calendarHeatmap({ '2024-05-01': 3, ... })
 *
 * options: from / to (default: the 53 weeks ending at the last date),
 *   weekStart 0 (Sunday) | 1 (Monday), cell 11, gap 3, levels 5,
 *   max (default: the largest value), locale.
 * Days are calendar dates (YYYY-MM-DD, UTC); times are ignored.
 *
 * Returns { width, height, cells: [{ date, value, level, x, y }],
 *   months: [{ label, x }], days: [{ label, y }], levels, max, total }
 */
const DAY = 86400000

const dayKey = (d) => new Date(d).toISOString().slice(0, 10)
const dayMs = (d) => Date.parse(`${typeof d === 'string' ? d.slice(0, 10) : dayKey(d)}T00:00:00Z`)

export function calendarHeatmap(
  data = [],
  { from, to, weekStart = 0, cell = 11, gap = 3, levels = 5, max, locale = 'en-US', labels = true } = {},
) {
  const values = new Map()
  const entries = Array.isArray(data)
    ? data.map((d) => [d.date, d.value])
    : Object.entries(data)
  for (const [date, value] of entries) {
    const t = dayMs(date)
    if (Number.isFinite(t)) values.set(t, (values.get(t) ?? 0) + (Number(value) || 0))
  }

  const known = [...values.keys()]
  const end = to != null ? dayMs(to) : known.length ? Math.max(...known) : dayMs(new Date())
  let start = from != null ? dayMs(from) : end - 52 * 7 * DAY
  // back up to the first day of that week
  start -= ((new Date(start).getUTCDay() - weekStart + 7) % 7) * DAY

  const top = max ?? Math.max(0, ...values.values())
  const levelOf = (v) => (v <= 0 || top <= 0 ? 0 : Math.min(levels - 1, Math.ceil((v / top) * (levels - 1))))

  const left = labels ? 28 : 0
  const head = labels ? 16 : 0
  const step = cell + gap
  const cells = []
  const months = []
  let lastMonth = -1
  let total = 0
  for (let t = start, i = 0; t <= end; t += DAY, i++) {
    const col = Math.floor(i / 7)
    const row = i % 7
    const value = values.get(t) ?? 0
    total += value
    cells.push({ date: dayKey(t), value, level: levelOf(value), x: left + col * step, y: head + row * step })
    const month = new Date(t).getUTCMonth()
    if (row === 0 && month !== lastMonth) {
      // label a month at the first week that starts in it
      if (new Date(t).getUTCDate() <= 7 || months.length === 0) {
        months.push({ label: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(t), x: left + col * step })
      }
      lastMonth = month
    }
  }
  const weeks = Math.ceil(cells.length / 7)
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const days = labels
    ? [1, 3, 5].map((row) => ({ label: dayFormat.format(Date.UTC(2024, 0, 7 + ((row + weekStart) % 7))), y: head + row * step + cell / 2 }))
    : []

  return {
    width: left + weeks * step - gap,
    height: head + 7 * step - gap,
    cell,
    cells,
    // a label too close to the next one is dropped (the earlier one:
    // that is a stray partial month at the start)
    months: months.filter((m, i) => i === months.length - 1 || months[i + 1].x - m.x >= step * 2.5),
    days,
    levels,
    max: top,
    total,
  }
}
