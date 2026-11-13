// Time axes. A series whose x values are Dates (or ISO date strings
// with `time: true`) is plotted on milliseconds, with ticks on calendar
// boundaries (whole minutes, hours, days, weeks, month starts, years)
// and labels formatted for the tick interval.
//
// Dates are shown in UTC by default so the server and the browser draw
// the same chart; pass `timeZone: 'local'` or an IANA zone to change it.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

// [unit, step, approximate ms]
const INTERVALS = [
  ['second', 1, SECOND], ['second', 5, 5 * SECOND], ['second', 15, 15 * SECOND], ['second', 30, 30 * SECOND],
  ['minute', 1, MINUTE], ['minute', 5, 5 * MINUTE], ['minute', 15, 15 * MINUTE], ['minute', 30, 30 * MINUTE],
  ['hour', 1, HOUR], ['hour', 3, 3 * HOUR], ['hour', 6, 6 * HOUR], ['hour', 12, 12 * HOUR],
  ['day', 1, DAY], ['day', 2, 2 * DAY], ['week', 1, WEEK], ['week', 2, 2 * WEEK],
  ['month', 1, 30 * DAY], ['month', 3, 91 * DAY], ['month', 6, 182 * DAY],
  ['year', 1, 365 * DAY],
]

// Works across realms (iframes) and through reactive proxies, where
// `instanceof Date` can be false.
export function isDate(value) {
  return (
    value instanceof Date ||
    (value != null && typeof value === 'object' && typeof value.getTime === 'function' && typeof value.toISOString === 'function')
  )
}

export function toTime(value) {
  if (isDate(value)) return value.getTime()
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return typeof value === 'number' ? value : null
}

/** True when any point's x is a Date. */
export function isTimeData(series = []) {
  return series.some((s) =>
    (s.data ?? []).some((d) => d && typeof d === 'object' && isDate(d.x)),
  )
}

function zoneOf(timeZone) {
  return timeZone === 'local' ? undefined : timeZone ?? 'UTC'
}

// Calendar parts in the chosen zone.
function parts(ms, timeZone) {
  const d = new Date(ms)
  if (zoneOf(timeZone) === 'UTC') {
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }
  }
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), dow: d.getDay() }
}

function makeDate(y, m, day, timeZone) {
  return zoneOf(timeZone) === 'UTC' ? Date.UTC(y, m, day) : new Date(y, m, day).getTime()
}

// Picks the interval whose tick count is closest to `count` (allowing
// up to 1.5x as many), so 6.4 monthly ticks beat 2 quarterly ones.
export function timeInterval(start, end, count = 6) {
  const span = Math.max(1, end - start)
  let best = null
  let bestScore = Infinity
  for (const iv of INTERVALS) {
    const n = span / iv[2]
    if (n > count * 1.5) continue
    const score = Math.abs(Math.log(Math.max(n, 1e-9) / count))
    if (score < bestScore) {
      bestScore = score
      best = iv
    }
  }
  if (best && span / (365 * 86400000) <= count * 1.5) return { unit: best[0], step: best[1] }
  const years = Math.ceil(span / (365 * DAY) / count)
  const nice = [1, 2, 5, 10, 20, 25, 50, 100].find((n) => n >= years) ?? years
  return { unit: 'year', step: nice }
}

/** Tick timestamps inside [start, end] on calendar boundaries. */
export function timeTicks(start, end, count = 6, { timeZone } = {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ticks: [], unit: 'day', step: 1 }
  if (start > end) [start, end] = [end, start]
  const { unit, step } = timeInterval(start, end, count)
  const ticks = []
  if (unit === 'second' || unit === 'minute' || unit === 'hour') {
    const size = { second: SECOND, minute: MINUTE, hour: HOUR }[unit] * step
    // Whole units (UTC offsets are whole minutes for nearly every zone).
    for (let t = Math.ceil(start / size) * size; t <= end; t += size) ticks.push(t)
  } else if (unit === 'day' || unit === 'week') {
    const p = parts(start, timeZone)
    let t = makeDate(p.y, p.m, p.d, timeZone)
    if (unit === 'week') t = makeDate(p.y, p.m, p.d - ((p.dow + 6) % 7), timeZone) // Mondays
    const stepDays = unit === 'week' ? 7 * step : step
    for (let i = 0; i < 1000; i++) {
      const q = parts(t, timeZone)
      if (t >= start && t <= end) ticks.push(t)
      if (t > end) break
      t = makeDate(q.y, q.m, q.d + stepDays, timeZone)
    }
  } else {
    const p = parts(start, timeZone)
    const months = unit === 'year' ? 12 * step : step
    let y = p.y
    let m = unit === 'year' ? 0 : Math.floor(p.m / step) * step
    if (unit === 'year') y = Math.floor(p.y / step) * step
    for (let i = 0; i < 1000; i++) {
      const t = makeDate(y, m, 1, timeZone)
      if (t > end) break
      if (t >= start) ticks.push(t)
      m += months
      y += Math.floor(m / 12)
      m %= 12
    }
  }
  return { ticks, unit, step }
}

const FORMATS = {
  second: { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
  minute: { hour: '2-digit', minute: '2-digit', hour12: false },
  hour: { hour: '2-digit', minute: '2-digit', hour12: false },
  day: { month: 'short', day: 'numeric' },
  week: { month: 'short', day: 'numeric' },
  month: { month: 'short', year: 'numeric' },
  year: { year: 'numeric' },
}

/** A label formatter for ticks of `unit`. */
export function timeFormatter(unit, { timeZone, locale = 'en-US' } = {}) {
  const f = new Intl.DateTimeFormat(locale, { ...FORMATS[unit], timeZone: zoneOf(timeZone) })
  return (v) => f.format(new Date(v))
}

/** A fuller formatter for tooltips (date, plus time for sub-day data). */
export function timeTooltipFormatter(unit, { timeZone, locale = 'en-US' } = {}) {
  const subDay = unit === 'second' || unit === 'minute' || unit === 'hour'
  const f = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(subDay ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    timeZone: zoneOf(timeZone),
  })
  return (v) => f.format(new Date(v))
}

/**
 * Time axis for [start, end] (ms or Dates):
 *   { ticks: [{ value, label }], unit, step, format, tooltip }
 */
export function timeAxis(start, end, count = 6, options = {}) {
  const s = toTime(start)
  const e = toTime(end)
  const { ticks, unit, step } = timeTicks(s, e, count, options)
  const format = timeFormatter(unit, options)
  return { ticks: ticks.map((value) => ({ value, label: format(value) })), unit, step, format, tooltip: timeTooltipFormatter(unit, options) }
}
