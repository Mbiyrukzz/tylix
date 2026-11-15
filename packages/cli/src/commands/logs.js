import fs from 'node:fs'
import path from 'node:path'
import { configureLogging, logFiles } from '@tylix/core'
import { detectLanguage, loadConfig } from '@tylix/shared'

const LEVEL_COLORS = {
  DEBUG: '\x1b[90m',
  INFO: '\x1b[36m',
  NOTICE: '\x1b[34m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  CRITICAL: '\x1b[1;31m',
  ALERT: '\x1b[1;35m',
  EMERGENCY: '\x1b[1;41m',
}
const color = process.stdout.isTTY && process.env.NO_COLOR === undefined

function paint(line) {
  if (!color) return line
  return line.replace(/^(\[[^\]]+\] [\w-]+\.)([A-Z]+)(:)/, (_, a, level, c) => `\x1b[90m${a}\x1b[0m${LEVEL_COLORS[level] ?? ''}${level}\x1b[0m${c}`)
}

async function loggingFiles(baseDir) {
  const config = await loadConfig(baseDir, await detectLanguage(baseDir))
  configureLogging(config.logging, { baseDir, environment: config.app.env })
  return logFiles()
}

function lastLines(file, count) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.slice(-count)
}

// tylix log:tail [channel] [--lines=50] [--level=error] [--no-follow]
// Prints the end of a channel's log file and keeps printing new lines.
export async function logTail({ channel, lines = 50, level, follow = true } = {}) {
  const baseDir = process.cwd()
  const files = await loggingFiles(baseDir)
  if (files.length === 0) {
    console.log('No log channel writes to a file. Add a single or daily channel to logging.channels, or set LOG_STACK=console,daily.')
    return
  }
  const pick = channel ? files.filter((f) => f.channel === channel) : files.slice(0, 1)
  if (pick.length === 0) {
    console.error(`No file channel named "${channel}". File channels: ${[...new Set(files.map((f) => f.channel))].join(', ')}.`)
    process.exitCode = 1
    return
  }
  const { path: file } = pick[0]
  const wanted = level ? new RegExp(`^\\[[^\\]]+\\] [\\w-]+\\.${level.toUpperCase()}:`) : null
  const show = (line) => {
    if (wanted && line.startsWith('[') && !wanted.test(line)) return
    console.log(paint(line))
  }

  console.log(`\x1b[90m${path.relative(baseDir, file)}\x1b[0m`)
  let size = 0
  if (fs.existsSync(file)) {
    for (const line of lastLines(file, lines)) show(line)
    size = fs.statSync(file).size
  } else {
    console.log('(empty: nothing logged yet)')
  }
  if (!follow) return

  let rest = ''
  fs.watchFile(file, { interval: 300 }, (current) => {
    if (current.size < size) size = 0 // cleared or rotated
    if (current.size === size) return
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(current.size - size)
    fs.readSync(fd, buffer, 0, buffer.length, size)
    fs.closeSync(fd)
    size = current.size
    const chunk = rest + buffer.toString('utf8')
    const parts = chunk.split('\n')
    rest = parts.pop()
    for (const line of parts) show(line)
  })
  process.on('SIGINT', () => process.exit(0))
}

// tylix log:clear [channel]: empties the log files (all daily files of a
// daily channel).
export async function logClear({ channel } = {}) {
  const baseDir = process.cwd()
  const files = (await loggingFiles(baseDir)).filter((f) => !channel || f.channel === channel)
  let removed = 0
  for (const f of files) {
    const dir = path.dirname(f.base)
    if (!fs.existsSync(dir)) continue
    const ext = path.extname(f.base)
    const stem = path.basename(f.base, ext)
    for (const name of fs.readdirSync(dir)) {
      const isOurs = f.daily ? name.startsWith(`${stem}-`) && name.endsWith(ext) && /\d{4}-\d{2}-\d{2}/.test(name) : name === path.basename(f.base)
      if (!isOurs) continue
      fs.rmSync(path.join(dir, name), { force: true })
      removed++
    }
  }
  console.log(removed ? `✔ Removed ${removed} log file(s).` : 'No log files to remove.')
}
