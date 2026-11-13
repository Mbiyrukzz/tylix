import {
  ElementNode,
  AttributeNode,
  TextNode,
  InterpolationNode,
  IfNode,
  EachNode,
  TemplateLiteralExpr,
} from '../ast/nodes.js'
import { parseExpressionString } from './parseExpressionString.js'

// Sticky regexes: matched at TemplateParser.pos via matchAt().
const TAG_NAME_RE = /[a-zA-Z][a-zA-Z0-9-]*/y
const ATTR_NAME_RE = /[a-zA-Z_:][a-zA-Z0-9_:.-]*/y

// Elements that never have children or a closing tag, so
// `<br>`, `<img src="x">` and `<input>` work without a trailing "/".
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

// HTML whitespace only -- NOT \s, which also matches U+00A0 and would
// swallow a literal non-breaking space.
const WS_ONLY_RE = /^[ \t\r\n\f]*$/
const WS_RUN_RE = /[ \t\r\n\f]+/g

// {{#each item in items}}            {{#each item of items}}
// {{#each item, i in items}}         {{#each [k, v] in Object.entries(o)}}
// {{#each { id, name } in rows}}
// group 1: item (name or destructuring pattern), 2: index name, 3: iterable
const EACH_HEADER_RE =
  /^(\[[^\]]*\]|\{[^}]*\}|[A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s+(?:in|of)\s+([\s\S]+)$/

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  larr: '\u2190',
  rarr: '\u2192',
  uarr: '\u2191',
  darr: '\u2193',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  bull: '\u2022',
  middot: '\u00B7',
  times: '\u00D7',
  divide: '\u00F7',
  plusmn: '\u00B1',
  deg: '\u00B0',
  laquo: '\u00AB',
  raquo: '\u00BB',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  euro: '\u20AC',
  pound: '\u00A3',
  yen: '\u00A5',
  cent: '\u00A2',
  sect: '\u00A7',
  para: '\u00B6',
  hearts: '\u2665',
  check: '\u2713',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
}

const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g

function decodeHtmlEntities(text) {
  return text.replace(ENTITY_RE, (match, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const codePoint = isHex
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      if (Number.isNaN(codePoint)) return match
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return match
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : match // unknown entity: leave as-is rather than mangling it
  })
}

// Finds the "}}" that closes a {{ ... }} whose content starts at
// `from` in `source`. Skips nested braces and string/template
// literals, so {{ fn({a:{b:1}}) }} and {{ "}}" }} work, where a plain
// indexOf('}}') would cut the expression short. A free function so
// attribute values can be scanned the same way as template text.
function findInterpEnd(source, from) {
  let depth = 0
  let quote = null
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0 && source[i + 1] === '}') return i
      if (depth > 0) depth--
    }
  }
  return -1
}

// `options` are the project's language options (see
// parser/languageOptions.js), e.g. { not: 'loose' }. They are passed
// to every expression parsed out of the template, so `{{ not a has b }}`
// follows the same `not` mode as script code.
//
// HTML comments (<!-- ... -->) are allowed anywhere a node is allowed
// and produce no output.
// Errors leave with `offset` (index into `source`) and, when known,
// `length`, so the dev overlay and editor can underline the spot.
export function parseTemplate(source, options = {}) {
  const parser = new TemplateParser(source, options)
  try {
    const nodes = parser.parseNodes(null)
    if (parser.pos < parser.source.length) {
      throw new Error(
        `Unexpected closing tag near: ${parser.remaining().slice(0, 30)}`,
      )
    }
    return nodes
  } catch (err) {
    if (err && typeof err === 'object') {
      if (err.templateOffset !== undefined) {
        err.offset = err.templateOffset
        delete err.templateOffset
      } else {
        err.offset = parser.pos
        delete err.length
      }
    }
    throw err
  }
}

// Marks where in the template an error belongs (first mark wins).
function markAt(err, offset, length) {
  if (err && typeof err === 'object' && err.templateOffset === undefined) {
    err.templateOffset = offset
    if (length !== undefined) err.length = length
  }
  return err
}

class TemplateParser {
  constructor(source, options = {}) {
    this.options = options
    this.source = source
    this.pos = 0
    // Elements and {{#if}}/{{#each}} blocks still open, innermost
    // last, so "unclosed" errors can point at the opening.
    this.open = []
    // Set by parseNodes: which marker it stopped at (the stopMarker,
    // one of alsoStopAt, or null for a closing tag).
    this.stopHit = null
    // Precomputed once so lineAt() is a binary search instead of
    // rescanning from the start on every node.
    this.lineStarts = [0]
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') this.lineStarts.push(i + 1)
    }
  }

  remaining() {
    return this.source.slice(this.pos)
  }

  // True when the source at the current position starts with `str`.
  // Same as remaining().startsWith(str) without copying the rest of
  // the template on every check.
  at(str) {
    return this.source.startsWith(str, this.pos)
  }

  matchAt(re) {
    re.lastIndex = this.pos
    return re.exec(this.source)
  }

  // A "<" starts markup only before a letter, "/" or "!--". Anything
  // else ("a < b", "<3") is literal text.
  isTagStart() {
    if (this.source[this.pos] !== '<') return false
    const next = this.source[this.pos + 1]
    if (next === undefined) return false
    return /[a-zA-Z/]/.test(next) || this.at('<!--')
  }

  // 1-based line number containing `pos`.
  lineAt(pos) {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  findInterpEnd(from) {
    return findInterpEnd(this.source, from)
  }

  // parseExpressionString on `raw`, which starts at `start` in the
  // template; errors are rebased onto the template.
  parseExpr(raw, start) {
    const lead = raw.length - raw.trimStart().length
    try {
      return parseExpressionString(raw.trim(), this.options)
    } catch (err) {
      throw markAt(err, start + lead + (err?.offset ?? 0), err?.length)
    }
  }

  // <!-- ... --> is skipped entirely: nothing inside it is parsed,
  // so {{ }} and tags inside a comment are inert.
  skipComment() {
    const line = this.lineAt(this.pos)
    const end = this.source.indexOf('-->', this.pos + 4)
    if (end === -1) {
      throw new Error(
        `Unterminated HTML comment starting at line ${line}: missing '-->'`,
      )
    }
    this.pos = end + 3
  }

  // Parses sibling nodes. `stopTag` (an HTML tag name) or `stopMarker`
  // (a literal like "{{/if}}") tell this call when to return; nested
  // control blocks / elements consume their own closing marker before
  // returning, so recursion handles arbitrary nesting automatically.
  // `alsoStopAt` lists marker PREFIXES (like "{{#else") that end this
  // call WITHOUT being consumed, so the caller can parse them itself.
  // After returning, this.stopHit says which one ended the call.
  parseNodes(stopTag, stopMarker = null, alsoStopAt = []) {
    const nodes = []
    while (this.pos < this.source.length) {
      if (stopMarker && this.at(stopMarker)) {
        this.pos += stopMarker.length
        this.stopHit = stopMarker
        return nodes
      }

      const also = alsoStopAt.find((m) => this.at(m))
      if (also) {
        this.stopHit = also
        return nodes
      }

      if (this.at('<!--')) {
        this.skipComment()
        continue
      }

      if (this.at('</')) {
        this.stopHit = null
        if (stopTag === null) return nodes
        this.consumeClosingTag(stopTag)
        return nodes
      }

      if (this.at('{{#if')) {
        nodes.push(this.parseIfBlock())
        continue
      }

      if (this.at('{{#each')) {
        nodes.push(this.parseEachBlock())
        continue
      }

      if (this.at('{{')) {
        nodes.push(this.parseInterpolation())
        continue
      }

      if (this.isTagStart()) {
        nodes.push(this.parseElement())
        continue
      }

      const text = this.parseText()
      if (WS_ONLY_RE.test(text)) {
        // JSX rule: whitespace-only runs containing a newline are
        // formatting and get dropped; a run on a single line sits
        // BETWEEN inline content (`{{ first }} {{ last }}`,
        // `<b>a</b> <i>b</i>`) and collapses to one real space.
        if (!text.includes('\n')) nodes.push(TextNode(' '))
      } else {
        // Collapse first, decode after, so `&nbsp;` survives.
        nodes.push(TextNode(decodeHtmlEntities(text.replace(WS_RUN_RE, ' '))))
      }
    }

    const opener = this.open[this.open.length - 1]
    if (stopMarker !== null) {
      throw markAt(
        new Error(
          `Unclosed block: reached end of template looking for "${stopMarker}"`,
        ),
        opener?.pos ?? this.pos,
        opener?.length,
      )
    }
    if (stopTag !== null) {
      throw markAt(
        new Error(`Unclosed tag <${stopTag}>: reached end of template`),
        opener?.pos ?? this.pos,
        opener?.length,
      )
    }
    this.stopHit = null
    return nodes
  }

  // Always consumes at least one character: when parseNodes lands
  // here the position is not at "{{" or real markup, so a "<" at the
  // very start is a literal "<" (as in "a < b").
  parseText() {
    const start = this.pos
    this.pos++
    while (
      this.pos < this.source.length &&
      !this.isTagStart() &&
      !this.at('{{')
    ) {
      this.pos++
    }
    return this.source.slice(start, this.pos)
  }

  parseInterpolation() {
    const line = this.lineAt(this.pos)
    const start = this.pos + 2
    const end = this.findInterpEnd(start)
    if (end === -1) {
      throw new Error("Unterminated interpolation: missing '}}'")
    }
    const exprSource = this.source.slice(start, end).trim()
    if (exprSource.startsWith('#') || exprSource.startsWith('/')) {
      throw markAt(
        new Error(
          `Unexpected block tag "{{${exprSource}}}" at line ${line}: it has no matching opening or closing tag (check {{#if}} / {{#each}} / {{#else}} / {{/if}} / {{/each}})`,
        ),
        start - 2,
        end + 2 - (start - 2),
      )
    }
    this.pos = end + 2
    return {
      ...InterpolationNode(
        this.parseExpr(this.source.slice(start, end), start),
      ),
      line,
    }
  }

  parseIfBlock() {
    const line = this.lineAt(this.pos)
    const blockStart = this.pos
    this.pos += 2 // "{{"
    this.pos += 3 // "#if"
    this.skipWhitespace()
    const end = this.findInterpEnd(this.pos)
    if (end === -1) {
      throw new Error("Unterminated {{#if}} header: missing '}}'")
    }
    const conditionStart = this.pos
    const conditionSource = this.source.slice(this.pos, end)
    this.pos = end + 2
    this.open.push({ pos: blockStart, length: this.pos - blockStart })
    const node = this.parseIfRest(conditionSource, line, conditionStart)
    this.open.pop()
    return node
  }

  // Parses the body of an {{#if}} (header already consumed), plus an
  // optional {{#else}} or {{#else if cond}} chain. An else-if is a
  // nested IfNode in elseChildren that shares the single {{/if}}.
  parseIfRest(conditionSource, line, conditionStart) {
    const children = this.parseNodes(null, '{{/if}}', ['{{#else'])

    let elseChildren = null
    if (this.stopHit === '{{#else') {
      this.pos += '{{#else'.length
      this.skipWhitespace()
      const elseLine = this.lineAt(this.pos)
      const end = this.findInterpEnd(this.pos)
      if (end === -1) {
        throw new Error("Unterminated {{#else}} header: missing '}}'")
      }
      const headerStart = this.pos
      const header = this.source.slice(this.pos, end).trim()
      this.pos = end + 2

      const elseIf = /^if\b\s*([\s\S]+)$/.exec(header)
      if (header === '') {
        elseChildren = this.parseNodes(null, '{{/if}}')
      } else if (elseIf) {
        const condStart = headerStart + elseIf[0].length - elseIf[1].length
        elseChildren = [this.parseIfRest(elseIf[1], elseLine, condStart)]
      } else {
        throw new Error(
          `Invalid {{#else}} header "${header}" at line ${elseLine}: expected {{#else}} or {{#else if condition}}`,
        )
      }
    }

    return {
      ...IfNode(
        this.parseExpr(conditionSource, conditionStart),
        children,
        elseChildren,
      ),
      line,
    }
  }

  parseEachBlock() {
    const line = this.lineAt(this.pos)
    const blockStart = this.pos
    this.pos += 2 // "{{"
    this.pos += 5 // "#each"
    this.skipWhitespace()
    const end = this.findInterpEnd(this.pos)
    if (end === -1) {
      throw new Error("Unterminated {{#each}} header: missing '}}'")
    }
    const headerStart = this.pos
    const header = this.source.slice(this.pos, end).trim()
    this.pos = end + 2

    const match = EACH_HEADER_RE.exec(header)
    if (!match) {
      throw markAt(
        new Error(
          `Invalid {{#each}} header "${header}": expected "item in items", "item, index in items" or "[a, b] in pairs"`,
        ),
        blockStart,
        this.pos - blockStart,
      )
    }
    const itemName = match[1]
    const indexName = match[2] ?? null
    const iterableSource = match[3]
    const iterableStart = headerStart + header.length - match[3].length

    this.open.push({ pos: blockStart, length: this.pos - blockStart })
    const children = this.parseNodes(null, '{{/each}}', ['{{#else'])

    let elseChildren = null
    if (this.stopHit === '{{#else') {
      this.pos += '{{#else'.length
      this.skipWhitespace()
      const elseEnd = this.findInterpEnd(this.pos)
      if (elseEnd === -1) {
        throw new Error("Unterminated {{#else}} header: missing '}}'")
      }
      const elseHeader = this.source.slice(this.pos, elseEnd).trim()
      if (elseHeader !== '') {
        throw new Error(
          `{{#else}} inside {{#each}} takes no condition (got "${elseHeader}")`,
        )
      }
      this.pos = elseEnd + 2
      elseChildren = this.parseNodes(null, '{{/each}}')
    }
    this.open.pop()

    return {
      ...EachNode(
        itemName,
        this.parseExpr(iterableSource, iterableStart),
        children,
        indexName,
        elseChildren,
      ),
      line,
    }
  }

  parseElement() {
    const line = this.lineAt(this.pos)
    const elementStart = this.pos
    this.pos++
    const tag = this.readTagName()
    const attributes = this.parseAttributes()

    this.skipWhitespace()
    if (this.at('/>')) {
      this.pos += 2
      return { ...ElementNode(tag, attributes, []), line }
    }

    if (this.source[this.pos] !== '>') {
      throw new Error(`Expected '>' to close <${tag}> tag`)
    }
    this.pos++

    // <br>, <img ...>, <input ...>: no children, no closing tag.
    if (VOID_ELEMENTS.has(tag)) {
      return { ...ElementNode(tag, attributes, []), line }
    }

    // <pre> is a raw-text element, same idea as <script>/<style> in
    // real HTML: its content is captured verbatim -- no whitespace
    // collapsing, and critically no {{ }} interpolation/control-flow
    // parsing -- so code samples containing literal "{{#each}}" etc.
    // display as text instead of being executed as real template
    // syntax.
    if (tag === 'pre') {
      const closeTag = '</pre>'
      const closeIndex = this.source.indexOf(closeTag, this.pos)
      if (closeIndex === -1) {
        throw new Error('Unclosed <pre> tag: reached end of template')
      }
      const rawContent = this.source.slice(this.pos, closeIndex)
      this.pos = closeIndex + closeTag.length
      return {
        ...ElementNode(tag, attributes, [TextNode(rawContent)]),
        line,
      }
    }

    this.open.push({ pos: elementStart, length: tag.length + 1 })
    const children = this.parseNodes(tag)
    this.open.pop()
    return { ...ElementNode(tag, attributes, children), line }
  }

  consumeClosingTag(expectedTag) {
    const closeStart = this.pos
    this.pos += 2
    const name = this.readTagName()
    this.skipWhitespace()
    if (this.source[this.pos] !== '>') {
      throw new Error(`Expected '>' after closing tag name '${name}'`)
    }
    this.pos++
    if (name !== expectedTag) {
      throw markAt(
        new Error(
          `Mismatched closing tag: expected </${expectedTag}>, got </${name}>`,
        ),
        closeStart,
        this.pos - closeStart,
      )
    }
  }

  readTagName() {
    const match = this.matchAt(TAG_NAME_RE)
    if (!match) {
      throw new Error(`Expected a tag name at position ${this.pos}`)
    }
    this.pos += match[0].length
    return match[0]
  }

  parseAttributes() {
    const attributes = []
    this.skipWhitespace()
    while (
      this.pos < this.source.length &&
      this.source[this.pos] !== '>' &&
      !this.at('/>')
    ) {
      attributes.push(this.parseAttribute())
      this.skipWhitespace()
    }
    return attributes
  }

  parseAttribute() {
    const line = this.lineAt(this.pos)
    const nameMatch = this.matchAt(ATTR_NAME_RE)
    if (!nameMatch) {
      throw new Error(`Expected an attribute name at position ${this.pos}`)
    }
    const name = nameMatch[0]
    this.pos += name.length
    this.skipWhitespace()

    // No '=' following the name means a bare boolean attribute
    // (e.g. <input disabled>, <div data-tylix-slot>).
    if (this.source[this.pos] !== '=') {
      return { ...AttributeNode(name, true, false), line }
    }

    this.pos++
    this.skipWhitespace()

    const quote = this.source[this.pos]
    let rawValue
    let valueStart

    if (quote === '"' || quote === "'") {
      this.pos++
      valueStart = this.pos
      while (this.pos < this.source.length && this.source[this.pos] !== quote) {
        this.pos++
      }
      if (this.pos >= this.source.length) {
        throw new Error(`Unterminated attribute value for '${name}'`)
      }
      rawValue = this.source.slice(valueStart, this.pos)
      this.pos++
    } else {
      // Unquoted value (<input type=text>): runs to whitespace or
      // '>'. A {{ ... }} inside it is scanned as a unit, so
      // `value={{ a + b }}` keeps its spaces.
      valueStart = this.pos
      while (
        this.pos < this.source.length &&
        !/[\s>]/.test(this.source[this.pos])
      ) {
        if (this.at('{{')) {
          const end = this.findInterpEnd(this.pos + 2)
          if (end === -1) {
            throw new Error(
              `Unterminated '{{' in attribute '${name}' at line ${line}`,
            )
          }
          this.pos = end + 2
        } else {
          this.pos++
        }
      }
      rawValue = this.source.slice(valueStart, this.pos)
      if (rawValue === '') {
        throw new Error(`Expected a value for attribute '${name}'`)
      }
    }

    return { ...this.buildAttribute(name, rawValue, line, valueStart), line }
  }

  // Splits an attribute value into literal text and {{ }} parts.
  //   "plain"                      -> static string
  //   "{{ expr }}"                 -> the expression itself (type kept:
  //                                   numbers stay numbers, etc.)
  //   "btn {{ a }} x-{{ b }}"      -> a template literal
  // Literal text has HTML entities decoded (title="a &amp; b").
  buildAttribute(name, rawValue, line, valueStart = 0) {
    if (!rawValue.includes('{{')) {
      return AttributeNode(name, decodeHtmlEntities(rawValue), false)
    }

    const parts = []
    let text = ''
    let i = 0
    while (i < rawValue.length) {
      if (rawValue.startsWith('{{', i)) {
        const end = findInterpEnd(rawValue, i + 2)
        if (end === -1) {
          throw new Error(
            `Unterminated '{{' in attribute '${name}' at line ${line}`,
          )
        }
        if (text) {
          parts.push({ type: 'text', value: decodeHtmlEntities(text) })
          text = ''
        }
        parts.push({
          type: 'expr',
          expression: this.parseExpr(
            rawValue.slice(i + 2, end),
            valueStart + i + 2,
          ),
        })
        i = end + 2
      } else {
        text += rawValue[i++]
      }
    }
    if (text) parts.push({ type: 'text', value: decodeHtmlEntities(text) })

    if (parts.length === 1 && parts[0].type === 'expr') {
      return AttributeNode(name, parts[0].expression, true)
    }
    return AttributeNode(name, TemplateLiteralExpr(parts), true)
  }

  skipWhitespace() {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++
    }
  }
}