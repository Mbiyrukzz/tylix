// Terminal colours. On when the stream is a terminal; NO_COLOR (any value)
// turns them off and FORCE_COLOR (anything but 0) turns them on.
//   bold('x')                 for stdout
//   colorsFor(process.stderr) for another stream

function enabledFor(stream) {
  if (process.env.NO_COLOR !== undefined) return false
  const force = process.env.FORCE_COLOR
  if (force !== undefined && force !== '') return force !== '0' && force !== 'false'
  return Boolean(stream?.isTTY) && process.env.TERM !== 'dumb'
}

const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  cyanBright: [96, 39],
}

export function colorsFor(stream) {
  const on = enabledFor(stream)
  return Object.fromEntries(
    Object.entries(CODES).map(([name, [open, close]]) => [
      name,
      on ? (text) => `\x1b[${open}m${text}\x1b[${close}m` : (text) => String(text),
    ]),
  )
}

const stdout = colorsFor(process.stdout)
export const { bold, dim, red, green, yellow, blue, magenta, cyan, white, gray, cyanBright } = stdout

// The Tylix palette, shared by the CLI banner and the starter templates.
export const BRAND = {
  blue: '#3D6BFF', // the logo blue (#0034CA), lifted to read on dark terminals
  deep: '#0034CA',
  sky: '#7FA0FF',
  mint: '#5FE3B5',
  coral: '#FF7B7B',
  peach: '#FFB38A',
  lime: '#C8F07A',
}

// How many colours the stream can show: 'truecolor', '256', 'basic' or
// 'none'. COLORTERM is how terminals announce 24-bit colour.
export function colorDepth(stream = process.stdout) {
  if (!enabledFor(stream)) return 'none'
  const colorterm = String(process.env.COLORTERM ?? '').toLowerCase()
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor'
  if (process.env.FORCE_COLOR === '3') return 'truecolor'
  if (/-256(color)?$/i.test(process.env.TERM ?? '')) return '256'
  return 'basic'
}

function hexToRgb(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

// The nearest colour in the xterm 6x6x6 cube.
function to256([r, g, b]) {
  const step = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40))
  return 16 + 36 * step(r) + 6 * step(g) + step(b)
}

const BASIC_FALLBACK = { blue: 34, cyan: 36, green: 32, red: 31, yellow: 33, magenta: 35, white: 37 }

/**
 * A painter for any hex colour, degrading to 256 colours, then to a basic
 * ANSI colour (`fallback`), then to plain text.
 *   hex('#3D6BFF', 'blue')('Tylix')
 */
export function hexFor(stream = process.stdout) {
  const depth = colorDepth(stream)
  return (color, fallback = 'white') => {
    if (depth === 'none') return (text) => String(text)
    if (depth === 'basic') {
      const code = BASIC_FALLBACK[fallback] ?? 37
      return (text) => `\x1b[${code}m${text}\x1b[39m`
    }
    const rgb = hexToRgb(color)
    const open = depth === 'truecolor' ? `38;2;${rgb.join(';')}` : `38;5;${to256(rgb)}`
    return (text) => `\x1b[${open}m${text}\x1b[39m`
  }
}

export const hex = hexFor(process.stdout)
