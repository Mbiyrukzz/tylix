import { bold, dim, cyan, cyanBright, magenta, green, gray } from './colors.js'

const LOGO = `████████╗██╗   ██╗██╗     ██╗██╗  ██╗
╚══██╔══╝╚██╗ ██╔╝██║     ██║╚██╗██╔╝
   ██║    ╚████╔╝ ██║     ██║ ╚███╔╝
   ██║     ╚██╔╝  ██║     ██║ ██╔██╗
   ██║      ██║   ███████╗██║██╔╝ ██╗
   ╚═╝      ╚═╝   ╚══════╝╚═╝╚═╝  ╚═╝`

export function printLogo() {
  console.log(cyanBright(LOGO))
  console.log(bold(magenta('        Tylix Framework')))
  console.log(dim('   Build Full-Stack JavaScript Applications'))
}

export function printDivider(width = 100) {
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
  const pad = width - text.length
  const left = Math.floor(pad / 2)
  const right = pad - left
  return ' '.repeat(Math.max(left, 0)) + text + ' '.repeat(Math.max(right, 0))
}

export function printBox(title) {
  const inner = BOX_WIDTH - 2
  const top = `╭${'─'.repeat(inner)}╮`
  const bottom = `╰${'─'.repeat(inner)}╯`
  const blank = `│${' '.repeat(inner)}│`
  console.log(cyan(top))
  console.log(cyan(blank))
  console.log(cyan('│') + bold(center(title, inner)) + cyan('│'))
  console.log(cyan(blank))
  console.log(cyan(bottom))
}

export function printChecklist(items) {
  for (const item of items) console.log(`${green('✓')} ${item}`)
}

export function printLinkSection(label, url) {
  console.log(`\n${dim(label)}`)
  console.log(cyanBright(url))
}
