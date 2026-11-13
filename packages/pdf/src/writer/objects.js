// PDF object values. In dictionaries and arrays:
//   numbers, booleans, null   as is
//   '/Name'                    a name (strings starting with "/")
//   other strings              a literal (text) string
//   PdfRef                     an indirect reference "n 0 R"
//   raw('...')                 written verbatim
//   hexString(bytes)           <...>
//   arrays, plain objects      arrays and dictionaries

export class PdfRef {
  constructor(id) {
    this.id = id
  }
  toString() {
    return `${this.id} 0 R`
  }
}

class Raw {
  constructor(text) {
    this.text = text
  }
}

class HexString {
  constructor(hex) {
    this.hex = hex
  }
}

export const raw = (text) => new Raw(text)
export const hexString = (hex) => new HexString(hex)

export function num(n) {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  const fixed = n.toFixed(4)
  return fixed.replace(/\.?0+$/, '') || '0'
}

const NAME_SAFE = /^[!-~]$/

function name(text) {
  let out = '/'
  for (const ch of text.slice(1)) {
    if (NAME_SAFE.test(ch) && !'#()<>[]{}/%'.includes(ch)) out += ch
    else
      for (const b of new TextEncoder().encode(ch)) out += '#' + b.toString(16).padStart(2, '0')
  }
  return out
}

// A text string: plain ASCII stays a literal, anything else becomes
// UTF-16BE with a byte-order mark so viewers show it correctly.
export function textString(text) {
  text = String(text)
  if (/^[\x20-\x7e\n\r\t]*$/.test(text)) {
    return '(' + text.replace(/([\\()])/g, '\\$1').replace(/\r/g, '\\r').replace(/\n/g, '\\n') + ')'
  }
  let hex = 'feff'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0')
  return '<' + hex + '>'
}

export function serialize(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return num(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value.startsWith('/') ? name(value) : textString(value)
  if (value instanceof PdfRef) return value.toString()
  if (value instanceof Raw) return value.text
  if (value instanceof HexString) return '<' + value.hex + '>'
  if (value instanceof Date) return textString(pdfDate(value))
  if (Array.isArray(value)) return '[' + value.map(serialize).join(' ') + ']'
  if (typeof value === 'object') {
    let out = '<<'
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      out += name('/' + k) + ' ' + serialize(v)
    }
    return out + '>>'
  }
  throw new TypeError(`Cannot write ${typeof value} into a PDF`)
}

export function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    'D:' +
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  )
}
