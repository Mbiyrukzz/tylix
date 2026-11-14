import readline from 'node:readline'
import { gray, bold, dim, hex, BRAND } from '@tylix/shared'

// Redraws at most this often for in-step updates; step changes always draw.
const THROTTLE_MS = 80

// Keep a line shorter than the terminal: a wrapped line would break the
// "move up 3 lines and redraw" trick.
function fit(text, columns) {
  const max = Math.max(10, columns - 1)
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// `steps` is a step count, or one weight per step so a slow step (such as
// installing packages) takes up a matching share of the bar.
export function createProgressBar(
  steps,
  { width = 20, stream = process.stdout } = {},
) {
  const weights = typeof steps === 'number' ? Array(steps).fill(1) : steps
  const total = weights.reduce((a, b) => a + b, 0) || 1
  // Weight of the steps before step i.
  const before = (i) => weights.slice(0, i).reduce((a, b) => a + b, 0)
  let drawn = false
  let lastDraw = 0
  let shown = 0
  // A throttled update, drawn when the throttle window ends so the last
  // state of a burst of updates isn't lost.
  let pending = null
  let timer = null

  function cancelPending() {
    clearTimeout(timer)
    timer = null
    pending = null
  }

  function draw(label, completed, detail) {
    if (drawn) {
      readline.moveCursor(stream, 0, -3)
      readline.clearScreenDown(stream)
    }
    drawn = true
    lastDraw = Date.now()

    // Progress inside a step is an estimate; never let the bar go backwards.
    shown = Math.max(shown, Math.min(total, completed))
    const ratio = shown / total
    const pct = Math.min(100, Math.floor(ratio * 100))
    const filled = Math.min(width, Math.floor(ratio * width))
    const bar =
      hex(BRAND.blue, 'blue')('▰'.repeat(filled)) +
      gray('▱'.repeat(width - filled))

    const columns = stream.columns || 80
    stream.write(`${bold(fit(label, columns))}\n`)
    stream.write(`${detail ? dim(fit(detail, columns)) : ''}\n`)
    stream.write(`${bar} ${bold(pct + '%')}\n`)
  }

  // Start of step `index` (index === step count for "Done"): always drawn.
  function render(label, index, detail = '') {
    cancelPending()
    draw(label, before(index), detail)
  }

  // Progress within the current step. `fraction` is 0..1 of step `index`.
  // Skipped when output isn't a terminal, so logs don't fill up with frames.
  function update(label, index, fraction, detail = '') {
    if (!stream.isTTY) return
    const share = (weights[index] ?? 0) * Math.max(0, Math.min(1, fraction))
    pending = [label, before(index) + share, detail]
    const wait = THROTTLE_MS - (Date.now() - lastDraw)
    if (wait <= 0) {
      const args = pending
      cancelPending()
      draw(...args)
    } else if (!timer) {
      timer = setTimeout(() => {
        const args = pending
        cancelPending()
        if (args) draw(...args)
      }, wait)
      // Never keep the process alive just to redraw.
      timer.unref?.()
    }
  }

  return { render, update }
}
