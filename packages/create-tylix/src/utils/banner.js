const LOGO = `████████╗██╗   ██╗██╗     ██╗██╗  ██╗
╚══██╔══╝╚██╗ ██╔╝██║     ██║╚██╗██╔╝
   ██║    ╚████╔╝ ██║     ██║ ╚███╔╝
   ██║     ╚██╔╝  ██║     ██║ ██╔██╗
   ██║      ██║   ███████╗██║██╔╝ ██╗
   ╚═╝      ╚═╝   ╚══════╝╚═╝╚═╝  ╚═╝`

export function printLogo() {
  console.log(LOGO)
  console.log('        Tylix Framework')
  console.log('   Build Full-Stack JavaScript Applications')
}

export function printDivider(width = 100) {
  console.log('─'.repeat(width))
}

export function printHeavyDivider(width = 54) {
  console.log('━'.repeat(width))
}

export function printSection(title, items) {
  console.log(title)
  for (const item of items) console.log(`✓ ${item}`)
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
  console.log(top)
  console.log(blank)
  console.log(`│${center(title, inner)}│`)
  console.log(blank)
  console.log(bottom)
}

export function printChecklist(items) {
  for (const item of items) console.log(`✓ ${item}`)
}

export function printLinkSection(label, url) {
  console.log(`\n${label}`)
  console.log(url)
}
