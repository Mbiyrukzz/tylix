import readline from 'node:readline'

function withRawMode(fn) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    readline.emitKeypressEvents(process.stdin)
    fn(resolve)
  })
}

function cleanup(onKeypress) {
  process.stdin.removeListener('keypress', onKeypress)
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
}

/**
 * Arrow-key single-select. choices: [{ label, value, hint? }]
 * Renders exactly: "❯ ● Label        hint" / "  ○ Label"
 */
export function select({ message, choices, initial = 0 }) {
  return withRawMode((resolve) => {
    let index = initial

    function draw() {
      console.log(message)
      for (const [i, choice] of choices.entries()) {
        const cursor = i === index ? '❯' : ' '
        const bullet = i === index ? '●' : '○'
        const hint = choice.hint ? `        ${choice.hint}` : ''
        console.log(`${cursor} ${bullet} ${choice.label}${hint}`)
      }
    }

    function clear() {
      readline.moveCursor(process.stdout, 0, -(choices.length + 1))
      readline.clearScreenDown(process.stdout)
    }

    draw()

    function onKeypress(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanup(onKeypress)
        process.exit(0)
      } else if (key.name === 'up') {
        index = (index - 1 + choices.length) % choices.length
        clear()
        draw()
      } else if (key.name === 'down') {
        index = (index + 1) % choices.length
        clear()
        draw()
      } else if (key.name === 'return') {
        cleanup(onKeypress)
        resolve(choices[index].value)
      }
    }

    process.stdin.on('keypress', onKeypress)
  })
}

/** Yes/No select, returns boolean */
export function confirm({ message, initial = true }) {
  return select({
    message,
    initial: initial ? 0 : 1,
    choices: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  })
}

/** Editable text field pre-filled with a default, shown as "❯ value" */
export function text({ message, initial = '' }) {
  return withRawMode((resolve) => {
    let value = initial

    function draw() {
      console.log(message)
      console.log(`❯ ${value}`)
    }
    function clear() {
      readline.moveCursor(process.stdout, 0, -2)
      readline.clearScreenDown(process.stdout)
    }

    draw()

    function onKeypress(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanup(onKeypress)
        process.exit(0)
      } else if (key.name === 'return') {
        cleanup(onKeypress)
        resolve(value)
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1)
        clear()
        draw()
      } else if (str && !key.ctrl && !key.meta) {
        value += str
        clear()
        draw()
      }
    }

    process.stdin.on('keypress', onKeypress)
  })
}
