// Rich text -> wrapped lines.
//
// A run is { text, font, size, color, link, underline, strike,
// background, characterSpacing, baseline }. Lines break at spaces, after
// hyphens, around CJK characters and at zero-width spaces; a word wider
// than the line is broken between characters.

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯\u{20000}-\u{2fa1f}]/u
const SOFT_HYPHEN = '­'

export function runWidth(run, text = run.text) {
  const chars = [...text].length
  return (run.font.measure(text) * run.size) / 1000 + (run.characterSpacing || 0) * chars
}

// Split runs into tokens: { type: 'word' | 'space' | 'newline', run,
// text, width }. A word token may join several runs (no break between
// "bold" and "ly" in "**bold**ly").
function tokenize(runs) {
  const tokens = []
  for (const run of runs) {
    const parts = run.text.replace(/\r\n?/g, '\n').match(/\n|[ \t]+|​|[^\s​]+/g) || []
    for (const part of parts) {
      if (part === '\n') tokens.push({ type: 'newline', run })
      else if (part === '​') tokens.push({ type: 'break', run })
      else if (/^[ \t]+$/.test(part)) tokens.push({ type: 'space', run, text: part.replace(/\t/g, '    ') })
      else {
        // Break opportunities inside the word: after hyphens and around
        // CJK characters.
        for (const piece of splitWord(part)) tokens.push({ type: 'word', run, text: piece.text, glue: piece.glue })
      }
    }
  }
  for (const t of tokens) {
    if (t.text) t.width = runWidth(t.run, t.text.replaceAll(SOFT_HYPHEN, ''))
  }
  return tokens
}

// Pieces of a word, split where a line may break: after hyphens, slashes
// and soft hyphens, and around CJK characters.
function splitWord(word) {
  const pieces = []
  let current = ''
  for (const ch of word) {
    if (CJK.test(ch)) {
      if (current) pieces.push({ text: current, glue: false })
      pieces.push({ text: ch, glue: false })
      current = ''
      continue
    }
    current += ch
    if (ch === '-' || ch === '‐' || ch === '/' || ch === SOFT_HYPHEN) {
      pieces.push({ text: current, glue: false })
      current = ''
    }
  }
  if (current) pieces.push({ text: current, glue: false })
  return pieces
}

const isBreakEnd = (t) => /[-‐/­]$/.test(t) || CJK.test(t)

// Lay runs into lines no wider than `width`.
// Returns [{ items: [{ run, text, width }], width, spaces, height,
// ascent, descent, hard }].
export function breakLines(runs, width, { lineHeight = 1.25 } = {}) {
  const tokens = tokenize(runs)
  const lines = []
  let line = newLine()

  function newLine() {
    return { items: [], width: 0, spaces: 0, pendingSpace: null }
  }

  function finish(hard) {
    // Trailing spaces don't count.
    const items = line.items
    while (items.length && items[items.length - 1].space) {
      line.width -= items.pop().width
      line.spaces--
    }
    // A soft hyphen at a line end shows as a hyphen.
    const last = items[items.length - 1]
    if (last && last.text.endsWith(SOFT_HYPHEN) && !hard) {
      last.text = last.text.slice(0, -1) + '-'
      const w = runWidth(last.run, last.text)
      line.width += w - last.width
      last.width = w
    }
    for (const item of items) item.text = item.text.replaceAll(SOFT_HYPHEN, '')
    lines.push(measureLine({ items: items.filter((i) => i.text), width: line.width, spaces: Math.max(0, line.spaces), hard }, lineHeight, runs[0]))
    line = newLine()
  }

  function add(item) {
    // Merge with the previous item if it's the same run (fewer text ops).
    const prev = line.items[line.items.length - 1]
    if (prev && prev.run === item.run && prev.space === item.space && !item.space) {
      prev.text += item.text
      prev.width += item.width
    } else line.items.push(item)
    line.width += item.width
    if (item.space) line.spaces += [...item.text].length
  }

  // Words joined by glue are kept together as a group.
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.type === 'newline') {
      finish(true)
      i++
      continue
    }
    if (t.type === 'break') {
      i++
      continue
    }
    if (t.type === 'space') {
      if (line.items.length) add({ run: t.run, text: t.text, width: t.width, space: true })
      i++
      continue
    }
    // Collect a group: this word plus following glued words.
    const group = [t]
    let j = i + 1
    while (j < tokens.length && tokens[j].type === 'word' && (tokens[j].glue || continuesWord(tokens[j - 1], tokens[j]))) {
      group.push(tokens[j])
      j++
    }
    const groupWidth = group.reduce((s, g) => s + g.width, 0)
    // The spaces before the word stay on the line, so they count.
    if (line.width + groupWidth <= width + 0.01 || !line.items.length) {
      if (groupWidth > width + 0.01 && !line.items.length) {
        // Too wide for any line: break inside it.
        for (const g of group) placeBroken(g)
      } else for (const g of group) add({ run: g.run, text: g.text, width: g.width })
      i = j
      continue
    }
    finish(false)
  }
  if (line.items.length || !lines.length) finish(true)
  return lines

  function placeBroken(token) {
    let chunk = ''
    let chunkWidth = 0
    for (const ch of token.text) {
      const w = runWidth(token.run, ch)
      if (line.width + chunkWidth + w > width + 0.01 && (chunk || line.items.length)) {
        if (chunk) add({ run: token.run, text: chunk, width: chunkWidth })
        finish(false)
        chunk = ''
        chunkWidth = 0
      }
      chunk += ch
      chunkWidth += w
    }
    if (chunk) add({ run: token.run, text: chunk, width: chunkWidth })
  }
}

// Adjacent word tokens from different runs with no space between them
// ("bold" + "ly") stay together, unless the first ends in a break point.
function continuesWord(a, b) {
  return a.type === 'word' && b.type === 'word' && a.run !== b.run && !isBreakEnd(a.text) && !CJK.test(b.text[0])
}

function measureLine(line, lineHeight, fallbackRun) {
  let ascent = 0
  let descent = 0
  let height = 0
  const runs = line.items.length ? line.items.map((i) => i.run) : [fallbackRun]
  for (const run of runs) {
    if (!run) continue
    const lh = run.lineHeight ?? lineHeight
    const a = (run.font.ascent / 1000) * run.size
    const d = (-run.font.descent / 1000) * run.size
    const content = a + d
    const h = lh <= 4 ? run.size * lh : lh // multiplier or absolute points
    const extra = (h - content) / 2
    ascent = Math.max(ascent, a + extra)
    descent = Math.max(descent, d + extra)
    height = Math.max(height, h)
  }
  return { ...line, ascent, descent, height: Math.max(height, ascent + descent) }
}

// Natural widths for auto-sized table columns: the longest unbreakable
// word (min) and the widest hard line (max).
export function naturalWidths(runs) {
  const tokens = tokenize(runs)
  let min = 0
  let max = 0
  let lineW = 0
  let word = 0
  let prev = null
  for (const t of tokens) {
    if (t.type === 'newline') {
      max = Math.max(max, lineW)
      lineW = 0
      word = 0
      continue
    }
    if (t.type === 'break') {
      word = 0
      continue
    }
    lineW += t.width || 0
    if (t.type === 'word') {
      word = prev && continuesWord(prev, t) ? word + t.width : t.width
      min = Math.max(min, word)
    } else word = 0
    prev = t
  }
  return { min, max: Math.max(max, lineW) }
}

// Draw laid-out lines with the top-left corner at (x, y).
export function drawLines(painter, lines, x, y, width, { align = 'left', decorations = true } = {}) {
  let top = y
  lines.forEach((line, index) => {
    const baseline = top + line.ascent
    let offset = 0
    let extraSpace = 0
    const free = width - line.width
    const lineAlign = align === 'justify' ? (line.hard || index === lines.length - 1 ? 'left' : 'justify') : align
    if (lineAlign === 'center') offset = free / 2
    else if (lineAlign === 'right') offset = free
    else if (lineAlign === 'justify' && line.spaces > 0 && free > 0) extraSpace = free / line.spaces

    let cursor = x + offset
    // One text operation per run of the same style (spaces included).
    const segments = []
    for (const item of line.items) {
      const prev = segments[segments.length - 1]
      if (prev && prev.run === item.run) {
        prev.text += item.text
        prev.width += item.width
        prev.space = prev.space && item.space
      } else segments.push({ ...item })
    }
    for (const item of segments) {
      const run = item.run
      const spaces = item.space ? [...item.text].length : (item.text.match(/ /g) || []).length
      const itemWidth = item.width + spaces * extraSpace
      const shift = run.baseline === 'super' ? -run.size * 0.35 : run.baseline === 'sub' ? run.size * 0.15 : 0
      if (run.background && decorations) {
        painter.save()
        painter.rect(cursor, top + (line.height - line.ascent - line.descent) / 2 + 0.5, itemWidth, line.ascent + line.descent - 1).fill(run.background)
        painter.restore()
      }
      if (!item.space) {
        painter.save()
        if (run.opacity != null && run.opacity < 1) painter.opacity(run.opacity)
        if (run.fauxBold) painter.lineWidth(run.size * 0.03).strokeColor(run.color ?? '#000')
        painter.showText(item.text, cursor, baseline + shift, {
          font: run.font,
          size: run.size,
          color: run.color,
          wordSpacing: extraSpace,
          characterSpacing: run.characterSpacing,
          render: run.fauxBold ? 2 : undefined,
        })
        painter.restore()
      }
      if (decorations && (run.underline || run.strike)) {
        const thickness = Math.max(0.5, (run.font.underlineThickness / 1000) * run.size)
        const color = run.decorationColor ?? run.color ?? '#000'
        painter.save()
        if (run.underline) {
          const uy = baseline + shift - (run.font.underlinePosition / 1000) * run.size
          painter.rect(cursor, uy - thickness / 2, itemWidth, thickness).fill(color)
        }
        if (run.strike) {
          const sy = baseline + shift - (run.font.ascent / 1000) * run.size * 0.3
          painter.rect(cursor, sy - thickness / 2, itemWidth, thickness).fill(color)
        }
        painter.restore()
      }
      if (run.link && !item.space) painter.link(run.link, cursor, top, itemWidth, line.height)
      cursor += itemWidth
    }
    top += line.height
  })
  return top - y
}
