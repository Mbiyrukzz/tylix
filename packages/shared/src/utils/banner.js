import {
  bold,
  dim,
  cyan,
  cyanBright,
  magenta,
  green,
  gray,
  yellow,
  blue,
  red,
} from './colors.js'

const LOGO = `████████╗██╗   ██╗██╗     ██╗██╗  ██╗
╚══██╔══╝╚██╗ ██╔╝██║     ██║╚██╗██╔╝
   ██║    ╚████╔╝ ██║     ██║ ╚███╔╝
   ██║     ╚██╔╝  ██║     ██║ ██╔██╗
   ██║      ██║   ███████╗██║██╔╝ ██╗
   ╚═╝      ╚═╝   ╚══════╝╚═╝╚═╝  ╚═╝`

export function printLogo({ version } = {}) {
  console.log(cyanBright(LOGO))
  const v = version ? `  ${dim('v' + version)}` : ''
  console.log(`${bold(magenta('Tylix Framework'))}${v}`)
  console.log(dim('Build Full-Stack JavaScript Applications'))
}

export function printDivider(width = 60) {
  console.log(gray('─'.repeat(width)))
}

export function printHeavyDivider(width = 54) {
  console.log(cyan('━'.repeat(width)))
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