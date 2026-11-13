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
