// Editor features for .tyx files that need nothing but text: where the
// cursor is, what to complete, what to show on hover, where a name is
// defined. Positions here are 0-based { line, character } like LSP.
//
// `doc` is the analysis of the open file (diagnoseTyx output plus its
// text); `project` describes the rest of the app:
//   { capabilities: Map<name, { file, text, symbols }>,
//     resolveImport(specifier) -> absolute .tyx path | null }

export const SECTION_KEYWORDS = {
  page: [
    'title', 'layout', 'props', 'state', 'computed', 'action', 'onMount',
    'uses', 'needs', 'prefetch', 'background', 'permissions', 'meta',
    'template', 'style',
  ],
  component: ['props', 'state', 'computed', 'action', 'onMount', 'template', 'style'],
  capability: ['state', 'action', 'init'],
}

const STATEMENT_KEYWORDS = [
  'const', 'let', 'if', 'else', 'for', 'in', 'of', 'from', 'to', 'repeat',
  'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'new', 'typeof',
  'instanceof', 'delete', 'void', 'function', 'this', 'true', 'false',
  'null', 'undefined',
]

const WORD_OPERATORS = ['and', 'or', 'not', 'is', 'has', 'exists', 'missing']

const TEMPLATE_GLOBALS = ['$event', 'props']

export const KEYWORD_DOCS = {
  and: '`a and b` — logical AND (same as `&&`).',
  or: '`a or b` — logical OR (same as `||`).',
  not: '`not x` — logical NOT (same as `!`). With `compiler: { not: "loose" }` the word binds looser than `is` / `has` / `exists`, so `not items has x` means `!(items has x)`.',
  is: '`a is b` — strict equality (`===`). `a is not b` is `!==`.',
  has: '`list has x` — membership: `list.includes(x)` for arrays and strings, `x in obj` for objects.',
  exists: '`x exists` — `x != null` (neither null nor undefined).',
  missing: '`x missing` — `x == null` (null or undefined).',
  repeat: '`repeat n { ... }` — run the block n times.',
  from: '`for i from 1 to 10 { ... }` — counting loop, both ends included.',
  to: '`for i from 1 to 10 { ... }` — counting loop, both ends included.',
  page: '`page Name` — a routed page. Sections: props, state, computed, action, onMount, uses, needs, template, style…',
  component: '`component Name` — a reusable component. Sections: props, state, computed, action, onMount, template, style.',
  capability: '`capability Name` — shared app state and actions, used from any page as `Name.member`. Sections: state, action, init.',
  props: 'Inputs passed by the parent: `name: Type` or `name?: Type`. Read them as `this.name`.',
  state: 'Reactive fields: `name: value` or `name(Type): value`. Assigning `this.name = …` re-renders.',
  computed: 'Derived values, recomputed when the state they read changes: `name() { return … }`.',
  action: 'Methods, callable from the template (`onclick="{{ save() }}"`) and from other actions as `this.save()`.',
  onMount: 'Runs in the browser after the page mounts: `onMount async { … }`.',
  init: 'Runs once when the capability is first used: `init async { … }`.',
  uses: 'Capabilities this page uses.',
  needs: 'Capabilities that must be ready (their `init` finished) before the page renders.',
  template: 'The markup. `{{ expr }}` inserts a value; `{{#if}}…{{#else}}…{{/if}}` and `{{#each item in items}}…{{/each}}` control it.',
  style: 'CSS for this file.',
}

// ---------------------------------------------------------------- text

export function offsetAt(text, { line, character }) {
  let offset = 0
  for (let l = 0; l < line; l++) {
    const next = text.indexOf('\n', offset)
    if (next === -1) return text.length
    offset = next + 1
  }
  return Math.min(text.length, offset + character)
}

export function positionAt(text, offset) {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, character: offset - lineStart }
}

const IDENT_CHAR = /[A-Za-z0-9_$]/

// The word under (or just before) the cursor, with what precedes it:
//   { word, start, end, qualifier }   qualifier: 'this' | 'Auth' | null
export function wordAt(text, offset) {
  let start = offset
  while (start > 0 && IDENT_CHAR.test(text[start - 1])) start--
  let end = offset
  while (end < text.length && IDENT_CHAR.test(text[end])) end++
  let qualifier = null
  if (text[start - 1] === '.') {
    let q = start - 1
    while (q > 0 && IDENT_CHAR.test(text[q - 1])) q--
    qualifier = text.slice(q, start - 1) || null
  }
  return { word: text.slice(start, end), start, end, qualifier }
}

// Where the cursor is:
//   { section: 'header' | 'script' | 'template' | 'style',
//     inExpression,      // inside {{ }} in the template
//     atLineStart,       // only whitespace before it on the line
//     indent,            // that whitespace's length
//     afterTagOpen }     // right after "<" in the template
export function contextAt(text, offset) {
  const before = text.slice(0, offset)
  const lineStart = before.lastIndexOf('\n') + 1
  const linePrefix = before.slice(lineStart)
  const atLineStart = /^[ \t]*[A-Za-z]*$/.test(linePrefix)
  const indent = linePrefix.length - linePrefix.trimStart().length

  const templateAt = lastLineMatch(before, /^template[ \t]*$/gm)
  const styleAt = lastLineMatch(before, /^style[ \t]*$/gm)
  let section = 'script'
  if (styleAt > -1 && styleAt > templateAt) section = 'style'
  else if (templateAt > -1) section = 'template'
  else if (!before.includes('\n')) section = 'header'

  let inExpression = false
  let afterTagOpen = false
  if (section === 'template') {
    const open = before.lastIndexOf('{{')
    inExpression = open > -1 && before.indexOf('}}', open) === -1
    afterTagOpen = !inExpression && /<[A-Za-z0-9-]*$/.test(linePrefix)
  }
  return { section, inExpression, atLineStart, indent, afterTagOpen }
}

function lastLineMatch(text, re) {
  let last = -1
  for (const m of text.matchAll(re)) last = m.index
  return last
}

// Loop variables of the {{#each}} blocks that are open at `offset`.
function eachVariablesAt(text, offset) {
  const names = []
  const re = /\{\{#each\s+(.+?)\s+(?:in|of)\s/g
  for (const m of text.slice(0, offset).matchAll(re)) {
    for (const n of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) names.push(n)
  }
  return names
}

// ----------------------------------------------------------- completion

// LSP CompletionItemKind numbers, so this file needs no LSP import.
const KIND = { Method: 2, Function: 3, Field: 5, Variable: 6, Class: 7, Property: 10, Keyword: 14, Snippet: 15, Module: 9 }

function memberItems(symbols) {
  const kindOf = { state: KIND.Field, computed: KIND.Property, action: KIND.Method, prop: KIND.Property }
  return symbols
    .filter((s) => kindOf[s.kind])
    .map((s) => ({
      label: s.name,
      kind: kindOf[s.kind],
      detail: `(${s.kind}) ${s.detail}`,
    }))
}

function capabilityItems(project) {
  return [...(project?.capabilities?.keys() ?? [])].map((name) => ({
    label: name,
    kind: KIND.Module,
    detail: `capability ${name}`,
  }))
}

const BLOCK_SNIPPETS = [
  { label: '{{#if}}', insertText: '{{#if ${1:condition}}}\n\t$0\n{{/if}}', detail: 'if block' },
  { label: '{{#if}} … {{#else}}', insertText: '{{#if ${1:condition}}}\n\t$2\n{{#else}}\n\t$0\n{{/if}}', detail: 'if / else block' },
  { label: '{{#each}}', insertText: '{{#each ${1:item} in ${2:items}}}\n\t$0\n{{/each}}', detail: 'each block' },
]

export function completions(doc, position, project) {
  const text = doc.text
  const offset = offsetAt(text, position)
  const ctx = contextAt(text, offset)
  const { qualifier } = wordAt(text, offset)
  const symbols = doc.symbols ?? []

  if (ctx.section === 'style' || ctx.section === 'header') return []

  // Something.member
  if (qualifier) {
    if (qualifier === 'this') return memberItems(symbols)
    const cap = project?.capabilities?.get(qualifier)
    if (cap) return memberItems(cap.symbols)
    return []
  }

  if (ctx.section === 'template') {
    if (ctx.inExpression) {
      return [
        ...memberItems(symbols),
        ...eachVariablesAt(text, offset).map((n) => ({ label: n, kind: KIND.Variable, detail: '(each) loop variable' })),
        ...capabilityItems(project),
        ...TEMPLATE_GLOBALS.map((n) => ({ label: n, kind: KIND.Variable })),
        ...WORD_OPERATORS.map((n) => ({ label: n, kind: KIND.Keyword, documentation: KEYWORD_DOCS[n] })),
      ]
    }
    if (ctx.afterTagOpen) {
      return (doc.imports ?? []).flatMap((imp) =>
        imp.names.map((n) => ({
          label: n.local,
          kind: KIND.Class,
          detail: `component from "${imp.specifier}"`,
        })),
      )
    }
    return BLOCK_SNIPPETS.map((s) => ({ ...s, kind: KIND.Snippet, insertTextFormat: 2 }))
  }

  // script
  const items = []
  if (ctx.atLineStart && ctx.indent === 0) {
    for (const k of SECTION_KEYWORDS[doc.kind] ?? []) {
      items.push({ label: k, kind: KIND.Keyword, detail: 'section', documentation: KEYWORD_DOCS[k] })
    }
    return items
  }
  items.push(
    ...STATEMENT_KEYWORDS.map((k) => ({ label: k, kind: KIND.Keyword })),
    ...WORD_OPERATORS.map((k) => ({ label: k, kind: KIND.Keyword, documentation: KEYWORD_DOCS[k] })),
    ...capabilityItems(project),
  )
  return items
}

// --------------------------------------------------------------- hover

function symbolHover(sym, where) {
  return {
    contents: {
      kind: 'markdown',
      value: `\`\`\`tylix\n(${sym.kind}) ${sym.detail}\n\`\`\`${where ? `\n${where}` : ''}`,
    },
  }
}

export function hover(doc, position, project) {
  const text = doc.text
  const offset = offsetAt(text, position)
  const { word, start, end, qualifier } = wordAt(text, offset)
  if (!word) return null
  const range = { start: positionAt(text, start), end: positionAt(text, end) }

  if (qualifier && qualifier !== 'this') {
    const cap = project?.capabilities?.get(qualifier)
    const sym = cap?.symbols.find((s) => s.name === word)
    return sym ? { ...symbolHover(sym, `Defined in capability **${qualifier}**`), range } : null
  }

  const sym = (doc.symbols ?? []).find((s) => s.name === word && s.kind !== 'lifecycle')
  if (sym) return { ...symbolHover(sym, `Line ${sym.line}`), range }

  const cap = project?.capabilities?.get(word)
  if (cap && !qualifier) {
    const members = cap.symbols
      .filter((s) => s.kind === 'state' || s.kind === 'action')
      .map((s) => `- ${s.detail}`)
      .join('\n')
    return {
      contents: { kind: 'markdown', value: `**capability ${word}**\n\n${members}` },
      range,
    }
  }

  if (!qualifier && KEYWORD_DOCS[word]) {
    return { contents: { kind: 'markdown', value: KEYWORD_DOCS[word] }, range }
  }
  return null
}

// ----------------------------------------------------------- definition

// The 0-based range of `name` on 1-based `line` of `text`.
function nameRange(text, line, name) {
  const lines = text.split('\n')
  const lineText = lines[line - 1] ?? ''
  const re = new RegExp(`(^|[^\\w$])(${name.replace(/[$]/g, '\\$')})(?![\\w$])`)
  const m = re.exec(lineText)
  const character = m ? m.index + m[1].length : 0
  return {
    start: { line: line - 1, character },
    end: { line: line - 1, character: character + (m ? name.length : 0) },
  }
}

// Returns { uri: 'self' | absolute path, range } or null.
export function definition(doc, position, project) {
  const text = doc.text
  const offset = offsetAt(text, position)
  const { word, start, qualifier } = wordAt(text, offset)
  if (!word) return null

  // import ... from "./X"  -> the file
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  const imp = /^\s*import\b.*?from\s*["']([^"']+)["']/.exec(lineText)
  if (imp) {
    const file = project?.resolveImport?.(imp[1])
    return file ? { uri: file, range: zeroRange() } : null
  }

  // <Card ...> -> the imported component file
  if (/<\/?$/.test(text.slice(Math.max(0, start - 2), start))) {
    for (const i of doc.imports ?? []) {
      if (i.names.some((n) => n.local === word) && i.kind === 'local') {
        const file = project?.resolveImport?.(i.specifier)
        if (file) return { uri: file, range: zeroRange() }
      }
    }
  }

  if (qualifier && qualifier !== 'this') {
    const cap = project?.capabilities?.get(qualifier)
    const sym = cap?.symbols.find((s) => s.name === word)
    return sym ? { uri: cap.file, range: nameRange(cap.text, sym.line, word) } : null
  }

  const sym = (doc.symbols ?? []).find((s) => s.name === word && s.kind !== 'lifecycle')
  if (sym) return { uri: 'self', range: nameRange(text, sym.line, word) }

  const cap = project?.capabilities?.get(word)
  if (cap) {
    return { uri: cap.file, range: nameRange(cap.text, 1, word) }
  }
  return null
}

function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
}

// -------------------------------------------------------------- symbols

// LSP SymbolKind numbers.
const SYMBOL_KIND = { prop: 7, state: 8, computed: 7, action: 6, uses: 2, lifecycle: 12 }

export function documentSymbols(doc) {
  return (doc.symbols ?? []).map((s) => {
    const range = nameRange(doc.text, s.line, s.name)
    return {
      name: s.name,
      detail: s.kind,
      kind: SYMBOL_KIND[s.kind] ?? 13,
      range,
      selectionRange: range,
    }
  })
}
