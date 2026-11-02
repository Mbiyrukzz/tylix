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

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*/
const ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*/

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
  larr: '\u2190',
  rarr: '\u2192',
  uarr: '\u2191',
  darr: '\u2193',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
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
export function parseTemplate(source, options = {}) {
  const parser = new TemplateParser(source, options)
  const nodes = parser.parseNodes(null)
  if (parser.pos < parser.source.length) {
    throw new Error(
      `Unexpected closing tag near: ${parser.remaining().slice(0, 30)}`,
    )
  }
  return nodes
}

class TemplateParser {
  constructor(source, options = {}) {
    this.options = options
    this.source = source
    this.pos = 0
    // Set by parseNodes: which marker it stopped at (the stopMarker,
    // one of alsoStopAt, or null for a closing tag).
    this.stopHit = null
    // Precomputed once so lineAt() is a binary search instead of
    // rescanning from the start on every node -- parsing jumps around
    // via indexOf() in several places (interpolations, {{#if}}/
    // {{#each}} headers), so a running line counter threaded
    // incrementally (the way Lexer does it) would miss newlines that
    // fall inside a skipped range.
    this.lineStarts = [0]
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') this.lineStarts.push(i + 1)
    }
  }

  remaining() {
    return this.source.slice(this.pos)
  }

  // 1-based line number containing `pos`. Binary search over
  // lineStarts -- called once per node, so this stays cheap even on
  // large templates.
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
      if (stopMarker && this.remaining().startsWith(stopMarker)) {
        this.pos += stopMarker.length
        this.stopHit = stopMarker
        return nodes
      }

      const also = alsoStopAt.find((m) => this.remaining().startsWith(m))
      if (also) {
        this.stopHit = also
        return nodes
      }

      if (this.remaining().startsWith('</')) {
        this.stopHit = null
        if (stopTag === null) return nodes
        this.consumeClosingTag(stopTag)
        return nodes
      }

      if (this.remaining().startsWith('{{#if')) {
        nodes.push(this.parseIfBlock())
        continue
      }

      if (this.remaining().startsWith('{{#each')) {
        nodes.push(this.parseEachBlock())
        continue
      }

      if (this.remaining().startsWith('{{')) {
        nodes.push(this.parseInterpolation())
        continue
      }

      if (this.source[this.pos] === '<') {
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

    if (stopMarker !== null) {
      throw new Error(
        `Unclosed block: reached end of template looking for "${stopMarker}"`,
      )
    }
    if (stopTag !== null) {
      throw new Error(`Unclosed tag <${stopTag}>: reached end of template`)
    }
    this.stopHit = null
    return nodes
  }

  parseText() {
    const start = this.pos
    while (
      this.pos < this.source.length &&
      this.source[this.pos] !== '<' &&
      !this.remaining().startsWith('{{')
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
      throw new Error(
        `Unexpected block tag "{{${exprSource}}}" at line ${line}: it has no matching opening or closing tag (check {{#if}} / {{#each}} / {{#else}} / {{/if}} / {{/each}})`,
      )
    }
    this.pos = end + 2
    return {
      ...InterpolationNode(parseExpressionString(exprSource, this.options)),
      line,
    }
  }

  parseIfBlock() {
    const line = this.lineAt(this.pos)
    this.pos += 2 // "{{"
    this.pos += 3 // "#if"
    this.skipWhitespace()
    const end = this.findInterpEnd(this.pos)
    if (end === -1) {
      throw new Error("Unterminated {{#if}} header: missing '}}'")
    }
    const conditionSource = this.source.slice(this.pos, end).trim()
    this.pos = end + 2
    return this.parseIfRest(conditionSource, line)
  }

  // Parses the body of an {{#if}} (header already consumed), plus an
  // optional {{#else}} or {{#else if cond}} chain. An else-if is a
  // nested IfNode in elseChildren that shares the single {{/if}}.
  parseIfRest(conditionSource, line) {
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
      const header = this.source.slice(this.pos, end).trim()
      this.pos = end + 2

      const elseIf = /^if\b\s*([\s\S]+)$/.exec(header)
      if (header === '') {
        elseChildren = this.parseNodes(null, '{{/if}}')
      } else if (elseIf) {
        elseChildren = [this.parseIfRest(elseIf[1].trim(), elseLine)]
      } else {
        throw new Error(
          `Invalid {{#else}} header "${header}" at line ${elseLine}: expected {{#else}} or {{#else if condition}}`,
        )
      }
    }

    return {
      ...IfNode(
        parseExpressionString(conditionSource, this.options),
        children,
        elseChildren,
      ),
      line,
    }
  }

  parseEachBlock() {
    const line = this.lineAt(this.pos)
    this.pos += 2 // "{{"
    this.pos += 5 // "#each"
    this.skipWhitespace()
    const end = this.findInterpEnd(this.pos)
    if (end === -1) {
      throw new Error("Unterminated {{#each}} header: missing '}}'")
    }
    const header = this.source.slice(this.pos, end).trim()
    this.pos = end + 2

    const match = EACH_HEADER_RE.exec(header)
    if (!match) {
      throw new Error(
        `Invalid {{#each}} header "${header}": expected "item in items", "item, index in items" or "[a, b] in pairs"`,
      )
    }
    const itemName = match[1]
    const indexName = match[2] ?? null
    const iterableSource = match[3].trim()

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

    return {
      ...EachNode(
        itemName,
        parseExpressionString(iterableSource, this.options),
        children,
        indexName,
        elseChildren,
      ),
      line,
    }
  }

  parseElement() {
    const line = this.lineAt(this.pos)
    this.pos++
    const tag = this.readTagName()
    const attributes = this.parseAttributes()

    this.skipWhitespace()
    if (this.remaining().startsWith('/>')) {
      this.pos += 2
      return { ...ElementNode(tag, attributes, []), line }
    }

    if (this.source[this.pos] !== '>') {
      throw new Error(`Expected '>' to close <${tag}> tag`)
    }
    this.pos++

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

    const children = this.parseNodes(tag)
    return { ...ElementNode(tag, attributes, children), line }
  }

  consumeClosingTag(expectedTag) {
    this.pos += 2
    const name = this.readTagName()
    this.skipWhitespace()
    if (this.source[this.pos] !== '>') {
      throw new Error(`Expected '>' after closing tag name '${name}'`)
    }
    this.pos++
    if (name !== expectedTag) {
      throw new Error(
        `Mismatched closing tag: expected </${expectedTag}>, got </${name}>`,
      )
    }
  }

  readTagName() {
    const match = TAG_NAME_RE.exec(this.remaining())
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
      !this.remaining().startsWith('/>')
    ) {
      attributes.push(this.parseAttribute())
      this.skipWhitespace()
    }
    return attributes
  }

  parseAttribute() {
    const line = this.lineAt(this.pos)
    const nameMatch = ATTR_NAME_RE.exec(this.remaining())
    if (!nameMatch) {
      throw new Error(`Expected an attribute name at position ${this.pos}`)
    }
    const name = nameMatch[0]
    this.pos += name.length
    this.skipWhitespace()

    // No '=' following the name means a bare boolean attribute
    // (e.g. <input disabled>, <div data-tylix-slot>) rather than a
    // parse error -- matches real HTML's own boolean-attribute
    // convention, so devs coming from plain HTML don't hit a
    // surprising "Expected '=' after attribute name" wall.
    if (this.source[this.pos] !== '=') {
      return { ...AttributeNode(name, true, false), line }
    }

    this.pos++
    this.skipWhitespace()

    const quote = this.source[this.pos]
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected a quoted value for attribute '${name}'`)
    }
    this.pos++
    const valueStart = this.pos
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      this.pos++
    }
    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated attribute value for '${name}'`)
    }
    const rawValue = this.source.slice(valueStart, this.pos)
    this.pos++

    return { ...this.buildAttribute(name, rawValue, line), line }
  }

  // Splits an attribute value into literal text and {{ }} parts.
  //   "plain"                      -> static string
  //   "{{ expr }}"                 -> the expression itself (type kept:
  //                                   numbers stay numbers, etc.)
  //   "btn {{ a }} x-{{ b }}"      -> a template literal
  buildAttribute(name, rawValue, line) {
    if (!rawValue.includes('{{')) {
      return AttributeNode(name, rawValue, false)
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
          parts.push({ type: 'text', value: text })
          text = ''
        }
        parts.push({
          type: 'expr',
          expression: parseExpressionString(
            rawValue.slice(i + 2, end).trim(),
            this.options,
          ),
        })
        i = end + 2
      } else {
        text += rawValue[i++]
      }
    }
    if (text) parts.push({ type: 'text', value: text })

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