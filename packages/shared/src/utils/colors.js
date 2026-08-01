const isColorSupported =
  process.stdout.isTTY && process.env.NO_COLOR === undefined

function wrap(code) {
  return isColorSupported ? (str) => `\x1b[${code}m${str}\x1b[0m` : (str) => str
}

export const bold = wrap(1)
export const dim = wrap(2)
export const cyan = wrap(36)
export const cyanBright = wrap(96)
export const magenta = wrap(35)
export const green = wrap(32)
export const yellow = wrap(33)
export const red = wrap(31)
export const gray = wrap(90)
export const white = wrap(37)
