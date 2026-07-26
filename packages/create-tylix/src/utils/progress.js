import readline from 'node:readline'

/**
 * Renders a single progress bar in place instead of a scrolling list
 * of checkmarks. Call render(label, completedCount) before/after each
 * step -- completedCount is how many of totalSteps are done so far,
 * used to compute both the percentage and the filled bar width.
 */
export function createProgressBar(totalSteps, { width = 20 } = {}) {
  let drawn = false

  function render(label, completedCount) {
    if (drawn) {
      readline.moveCursor(process.stdout, 0, -3)
      readline.clearScreenDown(process.stdout)
    }
    drawn = true

    const pct = Math.min(100, Math.round((completedCount / totalSteps) * 100))
    const filled = Math.min(
      width,
      Math.round((completedCount / totalSteps) * width),
    )
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled)

    console.log(label)
    console.log()
    console.log(`${bar} ${pct}%`)
  }

  return { render }
}
