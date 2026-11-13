// One entry point for tools that need to know what is wrong with a
// .tyx file and where: `tylix check`, the dev error overlay and the
// editor language server all call diagnoseTyx().
//
//   const { kind, name, diagnostics, symbols } = diagnoseTyx(source, {
//     language: { not: 'loose' },  // same switches as the real build
//     typecheck: true,             // run the TypeScript checker (pages
//                                  // and components)
//     apiHelpersSource: '',        // app/useApi/*.ts, module syntax stripped
//   })
//
// Positions are 1-based lines and columns in `source` itself (not in a
// section), so they can be shown or underlined as they are.
//
// Only files that start with `page`, `component` or `capability` are
// Tylix. Anything else that happens to end in .tyx (generator
// templates, legacy <script>/<template> components) comes back as
// kind 'other' with no diagnostics.
import { Lexer } from '../lexer/Lexer.js'
import { Parser } from '../parser/Parser.js'
import { parsePageFile } from '../parser/parsePageFile.js'
import { parseComponentFile } from '../parser/parseComponentFile.js'
import { parseTemplate } from '../parser/parseTemplate.js'
import { normalizeLanguageOptions } from '../parser/languageOptions.js'
import { extractImports } from '../imports/extractImports.js'
import { typecheckPage } from '../typecheckPage.js'
import { generateParams } from '../codegen/generateExpression.js'

const HEADER_RE = /^\s*(page|component|capability)\s+([A-Za-z_$][A-Za-z0-9_$]*)/

// { kind: 'page' | 'component' | 'capability', name } or
// { kind: 'other', name: null }.
export function detectTyxKind(source) {
  const m = HEADER_RE.exec(source)
  return m ? { kind: m[1], name: m[2] } : { kind: 'other', name: null }
}

// 1-based { line, column } of a character offset.
export function offsetToPosition(source, offset) {
  const clamped = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: clamped - lineStart + 1 }
}

// Character offset of a 1-based line's first character.
function lineStartOffset(source, line) {
  let offset = 0
  for (let l = 1; l < line; l++) {
    const next = source.indexOf('\n', offset)
    if (next === -1) return source.length
    offset = next + 1
  }
  return offset
}

// Token types as people write them, for messages like
// "Unexpected token EQUALS" -> 'Unexpected "="'.
const TOKEN_TEXT = {
  EOF: 'end of input', IDENTIFIER: 'a name', NUMBER: 'a number',
  STRING: 'a string', TEMPLATE_LITERAL: 'a template literal',
  LBRACE: '{', RBRACE: '}', LPAREN: '(', RPAREN: ')', LBRACKET: '[',
  RBRACKET: ']', COLON: ':', COMMA: ',', EQUALS: '=', SEMICOLON: ';',
  DOT: '.', SPREAD: '...', ARROW: '=>', QUESTION: '?', QUESTION_DOT: '?.',
  NULLISH: '??', PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', PERCENT: '%',
  GT: '>', LT: '<', GTE: '>=', LTE: '<=', PIPE: '|', AMP: '&',
  PLUS_EQUALS: '+=', MINUS_EQUALS: '-=', PLUS_PLUS: '++', MINUS_MINUS: '--',
}

function tokenText(type) {
  if (TOKEN_TEXT[type]) {
    const t = TOKEN_TEXT[type]
    return /^[a-z]/.test(t) ? t : `"${t}"`
  }
  return `"${type.toLowerCase()}"` // keywords: ACTION -> "action"
}

// Messages carry "at line N" for the terminal; the position is now a
// field of its own, and N was often relative to a section anyway.
function cleanMessage(message) {
  return String(message ?? 'Unknown error')
    .replace(/\s+\(line \d+\)/g, '')
    .replace(/\s+(?:starting )?at line \d+(?=[\s,:;.)]|$)/g, '')
    .replace(/\b(Unexpected token|got) ([A-Z][A-Z_]+)\b/g, (_, lead, type) =>
      `${lead === 'got' ? 'got' : 'Unexpected'} ${tokenText(type)}`,
    )
    .trim()
}

function rangeDiagnostic(source, offset, length, message, origin) {
  const start = offsetToPosition(source, offset)
  const width = Math.max(1, length ?? 1)
  const end = offsetToPosition(source, offset + width)
  return {
    severity: 'error',
    origin,
    message: cleanMessage(message),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    offset,
    length: width,
  }
}

// A whole-line diagnostic (typecheck results only know the line).
function lineDiagnostic(source, line, message, origin) {
  const lines = source.split('\n')
  const safeLine = Math.max(1, Math.min(line, lines.length))
  const text = lines[safeLine - 1] ?? ''
  const indent = text.length - text.trimStart().length
  const offset = lineStartOffset(source, safeLine) + indent
  return {
    ...rangeDiagnostic(
      source,
      offset,
      Math.max(1, text.trimEnd().length - indent),
      message,
      origin,
    ),
    message: String(message).trim(),
  }
}

// Turns an error thrown while parsing one section into a diagnostic in
// the file. `base` is where that section's text starts in `source`.
function sectionError(source, err, base, origin) {
  if (typeof err?.offset === 'number') {
    return rangeDiagnostic(
      source,
      base + err.offset,
      err.length,
      err.message,
      origin,
    )
  }
  const m = /at line (\d+)/.exec(err?.message ?? '')
  const baseLine = offsetToPosition(source, base).line
  const line = m ? baseLine + Number(m[1]) - 1 : baseLine
  return lineDiagnostic(source, line, cleanMessage(err?.message), origin)
}

function describeParams(params) {
  try {
    return `(${generateParams(params ?? [], true)})`
  } catch {
    return '()'
  }
}

// Outline entries for the editor (document symbols, completion, hover).
// `line` is absolute; script AST lines count from the script start.
function collectSymbols(node, scriptLineBase) {
  const at = (l) => (typeof l === 'number' ? scriptLineBase + l - 1 : scriptLineBase)
  const out = []
  for (const p of node.props ?? []) {
    out.push({
      kind: 'prop',
      name: p.name,
      detail: `${p.name}${p.optional ? '?' : ''}: ${p.propType ?? 'any'}`,
      line: at(p.line),
    })
  }
  for (const s of node.state ?? []) {
    out.push({
      kind: 'state',
      name: s.name,
      detail: `${s.name}: ${s.typeAnnotation ?? 'any'}`,
      line: at(s.line),
    })
  }
  for (const c of node.computed ?? []) {
    out.push({
      kind: 'computed',
      name: c.name,
      detail: `${c.name}${c.returnType ? `: ${c.returnType}` : ''}`,
      line: at(c.line),
    })
  }
  for (const a of node.actions ?? []) {
    out.push({
      kind: 'action',
      name: a.name,
      detail: `${a.isAsync ? 'async ' : ''}${a.name}${describeParams(a.params)}${a.returnType ? `: ${a.returnType}` : ''}`,
      line: at(a.line),
    })
  }
  for (const u of [...(node.uses ?? []), ...(node.needs ?? [])]) {
    out.push({ kind: 'uses', name: u.name, detail: `uses ${u.name}`, line: at(u.line) })
  }
  if (node.onMount) {
    out.push({ kind: 'lifecycle', name: 'onMount', detail: 'onMount', line: at(node.onMount.line) })
  }
  if (node.init) {
    out.push({ kind: 'lifecycle', name: 'init', detail: 'init', line: at(node.init.line) })
  }
  return out
}

// "missing template section" while a line does start with `template`
// means an unclosed ( { or [ above it swallowed the keyword. Parsing
// the script up to that line finds the real mistake.
function hiddenTemplateError(source, clean, language) {
  const header = HEADER_RE.exec(clean)
  const templateLine = /^[ \t]*template[ \t]*\r?$/m.exec(clean)
  if (!header || !templateLine) return null
  const base = header.index + header[0].length
  const script = clean.slice(base, templateLine.index)
  let tokens
  try {
    tokens = new Lexer(script).tokenize()
  } catch (err) {
    return sectionError(source, err, base, 'syntax')
  }
  const pairs = { RPAREN: 'LPAREN', RBRACE: 'LBRACE', RBRACKET: 'LBRACKET' }
  const open = []
  for (const t of tokens) {
    if (t.type === 'LPAREN' || t.type === 'LBRACE' || t.type === 'LBRACKET') {
      open.push(t)
    } else if (pairs[t.type] && open.at(-1)?.type === pairs[t.type]) {
      open.pop()
    }
  }
  const culprit = open.at(-1)
  if (culprit) {
    return rangeDiagnostic(
      source,
      base + culprit.start,
      1,
      `"${culprit.value}" is never closed, so the template section below it is hidden`,
      'syntax',
    )
  }
  try {
    new Parser(tokens, language).parse()
  } catch (err) {
    return sectionError(source, err, base, 'syntax')
  }
  return null
}

export function diagnoseTyx(source, options = {}) {
  const { kind, name } = detectTyxKind(source)
  const result = { kind, name, diagnostics: [], symbols: [], imports: [] }
  if (kind === 'other') return result

  let language
  try {
    language = normalizeLanguageOptions(options.language ?? {})
  } catch (err) {
    result.diagnostics.push(lineDiagnostic(source, 1, err.message, 'config'))
    return result
  }

  // Import lines are blanked line-for-line, so lines (and columns below
  // the imports) are unchanged in `clean`.
  let clean = source
  if (kind !== 'capability') {
    try {
      const extracted = extractImports(source)
      clean = extracted.source
      result.imports = extracted.imports
    } catch (err) {
      const m = /line (\d+)/.exec(err.message)
      result.diagnostics.push(
        lineDiagnostic(source, m ? Number(m[1]) : 1, cleanMessage(err.message), 'imports'),
      )
      return result
    }
  }

  if (kind === 'capability') {
    try {
      const node = new Parser(new Lexer(clean).tokenize(), language).parseCapability()
      result.symbols = collectSymbols(node, 1)
    } catch (err) {
      result.diagnostics.push(sectionError(clean, err, 0, 'syntax'))
    }
    return result
  }

  let parts
  try {
    parts = kind === 'page' ? parsePageFile(clean) : parseComponentFile(clean)
  } catch (err) {
    result.diagnostics.push(hiddenTemplateError(clean, clean, language) ??
      lineDiagnostic(clean, 1, err.message, 'syntax'))
    return result
  }

  const scriptLineBase = offsetToPosition(clean, parts.scriptOffset).line
  if (parts.script.trim().length > 0) {
    try {
      const node = new Parser(new Lexer(parts.script).tokenize(), language).parse()
      result.symbols = collectSymbols(node, scriptLineBase)
    } catch (err) {
      result.diagnostics.push(sectionError(clean, err, parts.scriptOffset, 'syntax'))
    }
  }

  if (parts.template.trim().length > 0) {
    try {
      parseTemplate(parts.template, language)
    } catch (err) {
      result.diagnostics.push(
        sectionError(clean, err, parts.templateOffset, 'syntax'),
      )
    }
  }

  // Types only mean something once the file parses.
  if (options.typecheck && result.diagnostics.length === 0) {
    // typecheckPage wants a `page` header; a component has the same
    // sections. Same-length swap, so every line stays where it is.
    const asPage =
      kind === 'component'
        ? clean.replace(/^(\s*)component(\s)/, '$1page     $2')
        : clean
    try {
      for (const d of typecheckPage(asPage, options.apiHelpersSource ?? '', language)) {
        result.diagnostics.push(lineDiagnostic(clean, d.line, d.message, 'typecheck'))
      }
    } catch (err) {
      result.diagnostics.push(lineDiagnostic(clean, 1, err.message, 'typecheck'))
    }
  }

  // Offsets were measured in `clean`; give them in `source`.
  for (const d of result.diagnostics) {
    d.offset = lineStartOffset(source, d.line) + d.column - 1
  }
  return result
}

// "file:line:col  message" with a two-line code frame and a caret, for
// terminals and the dev overlay's plain-text copy.
export function formatDiagnostic(source, d, file = '') {
  const lines = source.split('\n')
  const out = [`${file ? `${file}:` : ''}${d.line}:${d.column}  ${d.message}`]
  const from = Math.max(1, d.line - 2)
  const to = Math.min(lines.length, d.line + 1)
  const width = String(to).length
  for (let l = from; l <= to; l++) {
    const marker = l === d.line ? '>' : ' '
    out.push(`${marker} ${String(l).padStart(width)} | ${lines[l - 1]}`)
    if (l === d.line) {
      const span =
        d.endLine === d.line ? Math.max(1, d.endColumn - d.column) : 1
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(d.column - 1)}${'^'.repeat(span)}`)
    }
  }
  return out.join('\n')
}
