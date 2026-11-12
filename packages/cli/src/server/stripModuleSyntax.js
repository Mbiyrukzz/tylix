// Turns a helper module into plain script text by blanking out `import`
// statements and the `export` keyword. Removed text becomes spaces and
// newlines are kept, so line numbers in error messages stay correct.
//
// A small scanner decides what counts as code. It tracks strings, template
// literals (with nested ${ }), comments and regex literals, so an
// `export const` inside a multi-line template or string is left alone.
// Only top-level statements are touched.

const REGEX_AFTER_PUNCT = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'void',
  'delete',
  'throw',
  'new',
  'await',
  'yield',
  'instanceof',
])
const DECLARATION_WORDS = new Set([
  'function',
  'async',
  'const',
  'let',
  'var',
  'class',
  'interface',
  'type',
  'enum',
  'abstract',
  'declare',
  'namespace',
])

const isIdentStart = (c) => /[A-Za-z_$]/.test(c ?? '')
const isIdentPart = (c) => /[A-Za-z0-9_$]/.test(c ?? '')
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

export function stripModuleSyntax(source) {
  const n = source.length
  const out = source.split('')
  const tplStack = [] // brace depth at each open ${ ... }
  let depth = 0
  let prev = '' // previous significant token, for regex-vs-division
  let i = 0

  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
    }
  }

  const skipSpaces = (j) => {
    while (j < n && isSpace(source[j])) j++
    return j
  }

  const readWord = (j) => {
    while (j < n && isIdentPart(source[j])) j++
    return j
  }

  // j is on the opening quote; returns the index after the closing one.
  // A quote never spans lines, so a stray one can't swallow the file.
  const skipString = (j) => {
    const quote = source[j]
    j++
    while (j < n) {
      const c = source[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === quote) return j + 1
      if (c === '\n') return j
      j++
    }
    return j
  }

  // j is just after "/". Returns the index after the regex and its flags.
  const skipRegex = (j) => {
    let inClass = false
    j++
    while (j < n) {
      const c = source[j]
      if (c === '\n') return j
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) {
        j++
        break
      }
      j++
    }
    while (isIdentPart(source[j])) j++
    return j
  }

  // Reads template text from j. Stops after the closing backtick, or after
  // a "${" (pushing onto tplStack, so the main loop scans the expression).
  const readTemplate = (j) => {
    while (j < n) {
      const c = source[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '`') return j + 1
      if (c === '$' && source[j + 1] === '{') {
        tplStack.push(depth)
        return j + 2
      }
      j++
    }
    return j
  }

  // j is on "{". Returns the index after the matching "}", or -1.
  const matchBrace = (j) => {
    let nest = 0
    while (j < n) {
      const c = source[j]
      if (c === '"' || c === "'") {
        j = skipString(j)
        continue
      }
      if (c === '{') nest++
      else if (c === '}') {
        nest--
        if (nest === 0) return j + 1
      }
      j++
    }
    return -1
  }

  // Index after the module specifier string ('./x.js') that ends an
  // import/export-from statement, or -1 if there is none.
  const endAfterSpecifier = (j) => {
    let nest = 0
    while (j < n) {
      const c = source[j]
      if (c === '"' || c === "'") {
        const end = skipString(j)
        if (nest === 0) return end
        j = end
        continue
      }
      if (c === '{') nest++
      else if (c === '}') nest--
      else if (c === ';' && nest === 0) return -1
      j++
    }
    return -1
  }

  // Includes a trailing ";" on the same line.
  const closeStatement = (end) => {
    let k = end
    while (k < n && (source[k] === ' ' || source[k] === '\t')) k++
    return source[k] === ';' ? k + 1 : end
  }

  // `export { a, b }`, `export { a } from 'x'`, `export * from 'x'`,
  // `export type { T }`. `k` is on the "{" or "*".
  const blankReExport = (start, k) => {
    let end
    if (source[k] === '{') {
      const afterBrace = matchBrace(k)
      if (afterBrace === -1) return null
      const m = skipSpaces(afterBrace)
      if (source.startsWith('from', m) && !isIdentPart(source[m + 4])) {
        end = endAfterSpecifier(m + 4)
        if (end === -1) return null
      } else {
        end = afterBrace
      }
    } else {
      end = endAfterSpecifier(k + 1)
      if (end === -1) return null
    }
    end = closeStatement(end)
    blank(start, end)
    return end
  }

  // Returns the index to continue scanning from, or null to leave the
  // word alone (dynamic import(), import.meta, an unknown export form).
  const handleModuleWord = (word, start, afterWord) => {
    const k = skipSpaces(afterWord)
    const c = source[k]

    if (word === 'import') {
      if (c === '(' || c === '.') return null
      const end = endAfterSpecifier(k)
      if (end === -1) return null
      const closed = closeStatement(end)
      blank(start, closed)
      return closed
    }

    if (c === '{' || c === '*') return blankReExport(start, k)
    if (!isIdentStart(c)) return null

    const wordEnd = readWord(k)
    const next = source.slice(k, wordEnd)

    if (next === 'default') {
      blank(start, wordEnd)
      return wordEnd
    }
    if (next === 'type') {
      const m = skipSpaces(wordEnd)
      if (source[m] === '{' || source[m] === '*') {
        return blankReExport(start, m)
      }
    }
    if (DECLARATION_WORDS.has(next)) {
      blank(start, afterWord)
      return afterWord
    }
    return null
  }

  while (i < n) {
    const c = source[i]

    if (isSpace(c)) {
      i++
      continue
    }

    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      i = close === -1 ? n : close + 2
      continue
    }

    if (c === '"' || c === "'") {
      i = skipString(i)
      prev = '"'
      continue
    }

    if (c === '`') {
      const before = tplStack.length
      i = readTemplate(i + 1)
      prev = tplStack.length > before ? '(' : '"'
      continue
    }

    if (c === '/') {
      const regexOk =
        prev === '' || REGEX_AFTER_PUNCT.has(prev) || REGEX_AFTER_WORD.has(prev)
      if (regexOk) {
        i = skipRegex(i)
        prev = '"'
      } else {
        prev = '/'
        i++
      }
      continue
    }

    if (c === '{' || c === '(' || c === '[') {
      depth++
      prev = c
      i++
      continue
    }

    if (c === '}') {
      // The "}" that closes a ${ ... } resumes the template text.
      if (tplStack.length && tplStack[tplStack.length - 1] === depth) {
        tplStack.pop()
        const before = tplStack.length
        i = readTemplate(i + 1)
        prev = tplStack.length > before ? '(' : '"'
        continue
      }
      depth = Math.max(0, depth - 1)
      prev = '}'
      i++
      continue
    }

    if (c === ')' || c === ']') {
      depth = Math.max(0, depth - 1)
      prev = c
      i++
      continue
    }

    if (isIdentStart(c)) {
      const wordEnd = readWord(i)
      const word = source.slice(i, wordEnd)

      // `export` is a reserved word, so at the top level (and not after a
      // ".") it can only be module syntax.
      if (
        (word === 'import' || word === 'export') &&
        depth === 0 &&
        tplStack.length === 0 &&
        prev !== '.'
      ) {
        const next = handleModuleWord(word, i, wordEnd)
        if (next !== null) {
          i = next
          prev = ';'
          continue
        }
      }

      prev = word
      i = wordEnd
      continue
    }

    // digits and any other punctuation
    prev = c
    i++
  }

  return out.join('')
}