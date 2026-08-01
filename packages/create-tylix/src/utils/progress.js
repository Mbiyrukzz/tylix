import readline from 'node:readline'
import { cyan, gray, bold } from '@tylix/shared'

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
    const bar = cyan('█'.repeat(filled)) + gray('░'.repeat(width - filled))

    console.log(bold(label))
    console.log()
    console.log(`${bar} ${bold(pct + '%')}`)
  }

  return { render }
}
