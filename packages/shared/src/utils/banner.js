import {
  bold,
  dim,
  cyan,
  cyanBright,
  green,
  gray,
  yellow,
  blue,
  red,
  hex,
  BRAND,
} from './colors.js'

// The Tylix mark (three slanted bars) and wordmark, drawn with quadrant
// block characters so they keep the logo's angles at terminal size.
const MARK = [
  '  ▄████████████████▛▘',
  '▗████████████████▀▘  ',
  '      ▄▄▄▄▖          ',
  '     ▟███▛ ▄▄▄▄▄     ',
  '    ▟███▛ ▟████▘     ',
  '  ▗████▛ ▟█▛▀▀       ',
  ' ▗████▛ ▀▘           ',
]

const WORDMARK = [
  '▄▄▄▄▄▄▄        ▗▄▖▗▄▖',
  '███████        ▐█▌▝▀▘',
  '  ▐█▌   ▜█  ▗█▌▐█▌▐█▌▝█▄  ▟▛',
  '  ▐█▌    ▜▙▗█▛ ▐█▌▐█▌  ▜▙█▀',
  '  ▐█▌    ▝██▛  ▐█▌▐█▌  ▟▛█▄',
  '  ▐█▌    ▗█▛▘  ▐█▌▐█▌▗█▀  ▜▙',
  '        ▗█▛',
]

const BANNER_WIDTH = 2 + MARK[0].length + 3 + Math.max(...WORDMARK.map((row) => row.length))

// Three status lights, the accent of the Tylix UI.
export function leds() {
  return [BRAND.coral, BRAND.peach, BRAND.mint]
    .map((color, i) => hex(color, ['red', 'yellow', 'green'][i])('●'))
    .join(' ')
}

export function printLogo({ version } = {}) {
  const v = version ? `  ${dim('v' + version)}` : ''
  const columns = process.stdout.columns ?? 80

  // Too narrow for the drawing: a one-line version instead.
  if (columns < BANNER_WIDTH) {
    console.log(`\n${hex(BRAND.blue, 'blue')('▰▰▰')} ${bold('Tylix')}${v}`)
    console.log(dim('Build full-stack JavaScript applications\n'))
    return
  }

  const markColor = hex(BRAND.blue, 'blue')
  console.log()
  for (let i = 0; i < MARK.length; i++) {
    console.log(`  ${markColor(MARK[i])}   ${bold(WORDMARK[i] ?? '')}`)
  }
  console.log()
  console.log(`  ${leds()}  ${bold('Tylix Framework')}${v}`)
  console.log(`         ${dim('Build full-stack JavaScript applications')}`)
  console.log()
}

export function printDivider(width = 60) {
  console.log(gray('─'.repeat(width)))
}

export function printHeavyDivider(width = 54) {
  console.log(hex(BRAND.blue, 'blue')('━'.repeat(width)))
}

export function printSection(title, items) {
  console.log(bold(title))
  for (const item of items) console.log(`${green('✓')} ${item}`)
}

const BOX_WIDTH = 64

function center(text, width) {
  const pad = Math.max(width - text.length, 0)
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + text + ' '.repeat(pad - left)
}

export function printBox(title) {
  const inner = BOX_WIDTH - 2
  const blank = `│${' '.repeat(inner)}│`
  console.log(cyan(`╭${'─'.repeat(inner)}╮`))
  console.log(cyan(blank))
  console.log(cyan('│') + bold(center(title, inner)) + cyan('│'))
  console.log(cyan(blank))
  console.log(cyan(`╰${'─'.repeat(inner)}╯`))
}

export function printChecklist(items) {
  for (const item of items) console.log(`${green('✓')} ${item}`)
}

export function printLinkSection(label, url) {
  console.log(`\n${dim(label)}`)
  console.log(cyanBright(url))
}

// Aligned "label   value" rows with a green tick.
export function printStatus(rows) {
  const width = Math.max(...rows.map(([label]) => label.length))
  for (const [label, value] of rows) {
    console.log(`  ${green('✓')} ${dim(label.padEnd(width))}  ${value}`)
  }
}

const METHOD_COLORS = { GET: green, POST: yellow, PUT: blue, DELETE: red }

export function printRoute(method, url, note = '') {
  const color = METHOD_COLORS[method] ?? gray
  const suffix = note ? `  ${dim(note)}` : ''
  console.log(`  ${color(bold(method.padEnd(6)))} ${url}${suffix}`)
}

export function printGroup(title) {
  console.log(`\n${bold(title)}`)
}

// Left-aligned "Label   url" rows for Local / Network / Login, etc.
export function printUrls(rows) {
  const width = Math.max(...rows.map(([label]) => label.length))
  for (const [label, url] of rows) {
    console.log(
      `  ${green('➜')} ${bold(label.padEnd(width))}  ${cyanBright(url)}`,
    )
  }
}