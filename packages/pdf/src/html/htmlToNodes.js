// HTML -> document nodes. Covers the markup people write for documents
// and emails: headings, paragraphs, inline formatting, links, lists,
// tables, images, blockquotes, code, rules and page breaks, with inline
// style="" for the common properties and class="" mapped to the
// document's named styles.

import { parseMarkup, parseStyle } from '../util/markup.js'

const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'dl', 'dt', 'dd', 'address', 'center', 'body', 'html', 'img-block'])
const SKIP = new Set(['head', 'script', 'style', 'title', 'meta', 'link', 'noscript', 'template', 'svg-skip'])

const BASE_SIZE = 10.5

function cssLength(value, base = BASE_SIZE) {
  if (value == null) return undefined
  const v = String(value).trim()
  const m = /^(-?[\d.]+)(px|pt|em|rem|%|mm|cm|in)?$/.exec(v)
  if (!m) return undefined
  const n = Number(m[1])
  switch (m[2]) {
    case 'px': return n * 0.75
    case 'em':
    case 'rem': return n * base
    case '%': return (n / 100) * base
    case 'mm': return (n * 72) / 25.4
    case 'cm': return (n * 72) / 2.54
    case 'in': return n * 72
    default: return n * (m[2] === 'pt' ? 1 : 0.75)
  }
}

function cssBox(value) {
  if (!value) return undefined
  const parts = String(value).trim().split(/\s+/).map((p) => cssLength(p) ?? 0)
  return parts.length === 1 ? parts[0] : parts
}

// CSS declarations -> node props.
function styleProps(css, tag) {
  const out = {}
  if (css.color) out.color = css.color
  const bg = css['background-color'] ?? (css.background && !/url\(/.test(css.background) ? css.background.split(/\s+/)[0] : undefined)
  if (bg) out.background = bg
  if (css['font-size']) out.size = cssLength(css['font-size']) ?? fontKeyword(css['font-size'])
  if (css['font-weight']) out.bold = css['font-weight'] === 'bold' || css['font-weight'] === 'bolder' || Number(css['font-weight']) >= 600
  if (css['font-style']) out.italic = /italic|oblique/.test(css['font-style'])
  if (css['font-family']) out.font = css['font-family']
  if (css['text-align']) out.align = css['text-align'] === 'start' ? 'left' : css['text-align'] === 'end' ? 'right' : css['text-align']
  if (css['line-height']) {
    const lh = css['line-height']
    out.lineHeight = /^[\d.]+$/.test(lh) ? Number(lh) : (cssLength(lh) ?? 14) / (out.size ?? BASE_SIZE)
  }
  if (css['letter-spacing']) out.characterSpacing = cssLength(css['letter-spacing'])
  const deco = css['text-decoration'] ?? css['text-decoration-line']
  if (deco) {
    if (/underline/.test(deco)) out.underline = true
    if (/line-through/.test(deco)) out.strike = true
    if (/none/.test(deco)) out.underline = out.strike = false
  }
  if (css['text-transform']) out.__transform = css['text-transform']
  if (css.margin) out.margin = cssBox(css.margin)
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const v = css[`margin-${side}`]
    if (v != null) out[`margin${side[0].toUpperCase()}${side.slice(1)}`] = cssLength(v) ?? 0
  }
  if (css.padding) out.padding = cssBox(css.padding)
  const border = css.border
  if (border && border !== 'none' && border !== '0') {
    const w = /([\d.]+(px|pt)?)/.exec(border)
    const c = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b[a-z]+\b)(?!.*(#|rgb|[a-z]))/i.exec(border.replace(/solid|dashed|dotted|double|none/g, ''))
    out.border = cssLength(w?.[1] ?? '1px') ?? 0.75
    if (c) out.borderColor = c[1]
    if (/dashed/.test(border)) out.border = { width: out.border, dash: [3, 2], color: out.borderColor }
  }
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const b = css[`border-${side}`]
    if (b && b !== 'none') {
      const w = cssLength(/([\d.]+(px|pt)?)/.exec(b)?.[1] ?? '1px') ?? 0.75
      const c = /(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i.exec(b)?.[1]
      const current = typeof out.border === 'object' ? out.border : { width: 0, top: 0, right: 0, bottom: 0, left: 0 }
      current[side] = w
      if (c) current.color = c
      out.border = current
    }
  }
  if (css['border-radius']) out.radius = cssLength(css['border-radius'])
  if (css.width && tag !== 'td' && tag !== 'th') out.width = cssLengthOrPercent(css.width)
  if (css.height && tag === 'img') out.height = cssLength(css.height)
  if (/always|page/.test(css['page-break-before'] ?? css['break-before'] ?? '')) out.pageBreak = 'before'
  if (/always|page/.test(css['page-break-after'] ?? css['break-after'] ?? '')) out.pageBreak = 'after'
  if (/avoid/.test(css['page-break-inside'] ?? css['break-inside'] ?? '')) out.unbreakable = true
  if (css['vertical-align']) out.valign = css['vertical-align']
  if (css.display === 'none') out.__hidden = true
  return out
}

function cssLengthOrPercent(v) {
  return String(v).trim().endsWith('%') ? String(v).trim() : cssLength(v)
}

function fontKeyword(k) {
  return { 'xx-small': 7, 'x-small': 7.5, small: 9, medium: BASE_SIZE, large: 13.5, 'x-large': 18, 'xx-large': 24, smaller: 9, larger: 13 }[k]
}

const INLINE_TAG_STYLE = {
  b: { bold: true }, strong: { bold: true }, i: { italic: true }, em: { italic: true }, cite: { italic: true }, var: { italic: true },
  u: { underline: true }, ins: { underline: true }, s: { strike: true }, strike: { strike: true }, del: { strike: true },
  code: { font: 'Courier', size: 9.5 }, kbd: { font: 'Courier', size: 9.5 }, samp: { font: 'Courier' }, tt: { font: 'Courier' },
  small: { size: 8.5 }, mark: { background: '#fef08a' }, big: { size: 13 },
}

export function htmlToNodes(html, doc) {
  const root = parseMarkup(String(html), { html: true })
  const body = findTag(root, 'body') ?? root
  return blockChildren(body, {}, doc)
}

function findTag(node, tag) {
  if (typeof node === 'string') return null
  if (node.tag === tag) return node
  for (const c of node.children) {
    const f = findTag(c, tag)
    if (f) return f
  }
  return null
}

function classStyles(el, doc) {
  const names = (el.attrs.class || '').split(/\s+/).filter(Boolean)
  const known = doc?.styles?.styles ?? {}
  const list = names.filter((n) => known[n])
  return list.length ? list : undefined
}

function elementProps(el, doc) {
  const css = parseStyle(el.attrs.style)
  const props = styleProps(css, el.tag)
  if (el.attrs.align) props.align = el.attrs.align
  if (el.attrs.bgcolor) props.background = el.attrs.bgcolor
  if (el.attrs.color) props.color = el.attrs.color
  const style = classStyles(el, doc)
  if (style) props.style = style
  if (el.attrs.id) props.id = el.attrs.id
  if ((el.attrs.class || '').split(/\s+/).includes('page-break')) props.pageBreak = 'after'
  return props
}

// Children of a block element -> nodes, grouping inline runs into
// paragraphs.
function blockChildren(el, inherited, doc, { pre = false } = {}) {
  const nodes = []
  let inline = []
  const flush = () => {
    const spans = normalizeInline(inline, pre)
    inline = []
    if (spans.length) nodes.push({ text: spans })
  }
  for (const child of el.children) {
    if (typeof child === 'string') {
      inline.push(child)
      continue
    }
    if (SKIP.has(child.tag)) continue
    if (child.tag === 'br') {
      inline.push('\n')
      continue
    }
    if (isBlock(child)) {
      flush()
      const node = blockNode(child, inherited, doc)
      if (node) nodes.push(node)
    } else {
      inline.push(...inlineSpans(child, doc, pre))
    }
  }
  flush()
  return nodes
}

function isBlock(el) {
  if (BLOCKS.has(el.tag)) return true
  if (el.tag === 'img') return !el.attrs.inline
  const display = parseStyle(el.attrs.style).display
  return display === 'block' || display === 'flex'
}

function blockNode(el, inherited, doc) {
  const props = elementProps(el, doc)
  if (props.__hidden) return null
  const transform = props.__transform
  delete props.__transform
  delete props.__hidden
  const tag = el.tag
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return { [tag]: inlineContent(el, doc, false, transform), ...props }
    case 'p':
    case 'address':
    case 'dt':
    case 'figcaption': {
      const children = blockChildren(el, inherited, doc)
      if (tag === 'dt') props.bold = props.bold ?? true
      if (tag === 'figcaption') props.style = props.style ?? 'caption'
      if (tag === 'address') props.italic = props.italic ?? true
      if (children.length === 1 && children[0].text !== undefined) return { text: applyTransform(children[0].text, transform), ...props }
      if (!children.length) return tag === 'p' ? { text: '', ...props } : null
      return { stack: children, ...props }
    }
    case 'pre': {
      const text = el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('').replace(/^\n/, '').replace(/\n$/, '')
      return { text, font: 'Courier', size: 9, lineHeight: 1.35, background: '#f3f4f6', padding: [8, 10], radius: 4, margin: [6, 0, 10, 0], ...props }
    }
    case 'blockquote':
      return { stack: blockChildren(el, inherited, doc), border: { width: 0, left: 3, color: '#d1d5db' }, padding: [2, 0, 2, 12], color: '#4b5563', margin: [6, 0, 10, 0], ...props }
    case 'hr':
      return { hr: { color: props.borderColor ?? props.color ?? '#e5e7eb' }, ...(props.margin != null ? { margin: props.margin } : {}) }
    case 'ul':
    case 'ol': {
      const items = el.children
        .filter((c) => typeof c !== 'string' && c.tag === 'li')
        .map((li) => {
          const liProps = elementProps(li, doc)
          const kids = blockChildren(li, inherited, doc)
          const content = kids.length === 1 && kids[0].text !== undefined ? { ...kids[0], ...liProps } : { stack: kids, ...liProps }
          return content
        })
      const listStyle = parseStyle(el.attrs.style)['list-style-type'] ?? el.attrs.type
      const node = { [tag]: items, ...props, margin: props.margin ?? [4, 0, 8, 0] }
      if (el.attrs.start) node.start = Number(el.attrs.start)
      if (listStyle) node.type = { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', 1: 'decimal' }[listStyle] ?? listStyle
      return node
    }
    case 'li':
      return { stack: blockChildren(el, inherited, doc), ...props }
    case 'table':
      return tableNode(el, props, doc)
    case 'img':
    case 'img-block':
      return imageNode(el, props)
    case 'dl':
      return { stack: blockChildren(el, inherited, doc), ...props }
    case 'dd':
      return { stack: blockChildren(el, inherited, doc), marginLeft: 18, marginBottom: 4, ...props }
    case 'center':
      return { stack: blockChildren(el, inherited, doc), align: 'center', ...props }
    default: {
      const children = blockChildren(el, inherited, doc)
      if (!children.length && !props.background && !props.border && props.pageBreak !== 'after') return null
      if (props.pageBreak === 'after' && !children.length) return { pageBreak: true }
      return { stack: children, ...props }
    }
  }
}

function imageNode(el, props) {
  const src = el.attrs.src
  if (!src) return null
  const node = { image: src, ...props }
  const w = el.attrs.width ? cssLength(el.attrs.width + (/^\d+$/.test(el.attrs.width) ? 'px' : '')) : undefined
  const h = el.attrs.height ? cssLength(el.attrs.height + (/^\d+$/.test(el.attrs.height) ? 'px' : '')) : undefined
  if (w && node.width == null) node.width = w
  if (h && node.height == null) node.height = h
  if (props.align) node.align = props.align
  delete node.padding
  return node
}

function tableNode(el, props, doc) {
  const rows = []
  const header = []
  const footer = []
  const walk = (node, section) => {
    for (const c of node.children) {
      if (typeof c === 'string') continue
      if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walk(c, c.tag)
      else if (c.tag === 'tr') {
        const cells = c.children
          .filter((x) => typeof x !== 'string' && (x.tag === 'td' || x.tag === 'th'))
          .map((cell) => {
            const cp = elementProps(cell, doc)
            const kids = blockChildren(cell, {}, doc)
            const content = kids.length === 1 && kids[0].text !== undefined ? { ...kids[0], ...stripBox(cp) } : { stack: kids, ...stripBox(cp) }
            if (cell.tag === 'th' && section !== 'thead' && !rowIsHeader(c)) content.bold = content.bold ?? true
            return { content, colSpan: Number(cell.attrs.colspan) || 1, background: cp.background, align: cp.align, valign: cp.valign, padding: cp.padding }
          })
        const target = section === 'thead' || (section !== 'tfoot' && !rows.length && !header.length && rowIsHeader(c)) ? header : section === 'tfoot' ? footer : rows
        target.push(cells)
      }
    }
  }
  walk(el, 'tbody')
  const borderAttr = el.attrs.border
  const table = {
    rows: [...header, ...rows],
    headerRows: header.length,
    borders: borderAttr && borderAttr !== '0' ? 'grid' : props.border ? 'grid' : 'horizontal',
  }
  if (footer.length) table.footer = footer
  if (props.border) {
    table.borderColor = props.borderColor ?? (typeof props.border === 'object' ? props.border.color : undefined)
  }
  if (el.attrs.cellpadding) table.padding = cssLength(el.attrs.cellpadding + 'px')
  const node = { table, margin: props.margin ?? [6, 0, 10, 0] }
  if (props.width) node.width = props.width
  for (const k of ['size', 'color', 'font', 'align']) if (props[k] !== undefined) node[k] = props[k]
  if (props.style) node.style = props.style
  return node
}

function rowIsHeader(tr) {
  const cells = tr.children.filter((x) => typeof x !== 'string')
  return cells.length > 0 && cells.every((x) => x.tag === 'th')
}

function stripBox(props) {
  const { background, padding, align, valign, ...rest } = props
  if (align) rest.align = align
  return rest
}

function textOf(el) {
  if (typeof el === 'string') return el
  if (el.tag === 'br') return '\n'
  return el.children.map(textOf).join('')
}

function inlineContent(el, doc, pre, transform) {
  const spans = []
  for (const c of el.children) {
    if (typeof c === 'string') spans.push(c)
    else if (c.tag === 'br') spans.push('\n')
    else spans.push(...inlineSpans(c, doc, pre))
  }
  return applyTransform(normalizeInline(spans, pre), transform)
}

function inlineSpans(el, doc, pre) {
  if (SKIP.has(el.tag)) return []
  if (el.tag === 'br') return ['\n']
  if (el.tag === 'img') {
    // Inline images aren't supported inside text; show the alt text.
    return el.attrs.alt ? [el.attrs.alt] : []
  }
  const props = { ...(INLINE_TAG_STYLE[el.tag] || {}), ...elementProps(el, doc) }
  if (props.__hidden) return []
  const transform = props.__transform
  delete props.__transform
  delete props.__hidden
  delete props.margin
  delete props.padding
  delete props.border
  delete props.width
  delete props.pageBreak
  if (el.tag === 'a' && el.attrs.href) props.link = el.attrs.href
  if (el.tag === 'sup') props.sup = true
  if (el.tag === 'sub') props.sub = true
  const children = []
  for (const c of el.children) {
    if (typeof c === 'string') children.push(c)
    else children.push(...inlineSpans(c, doc, pre || el.tag === 'pre'))
  }
  const text = applyTransform(children, transform)
  if (props.sup) {
    delete props.sup
    return [{ sup: text, ...props }]
  }
  if (props.sub) {
    delete props.sub
    return [{ sub: text, ...props }]
  }
  return [{ text, ...props }]
}

function applyTransform(content, transform) {
  if (!transform || transform === 'none') return content
  const fn = transform === 'uppercase' ? (s) => s.toUpperCase() : transform === 'lowercase' ? (s) => s.toLowerCase() : transform === 'capitalize' ? (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()) : (s) => s
  const walk = (c) => (typeof c === 'string' ? fn(c) : Array.isArray(c) ? c.map(walk) : c && typeof c === 'object' ? { ...c, text: walk(c.text) } : c)
  return walk(content)
}

// Collapse whitespace like a browser and drop empty edges.
function normalizeInline(spans, pre) {
  if (pre) return spans
  const flat = []
  let lastSpace = true
  const walk = (s) => {
    if (typeof s === 'string') {
      if (s === '\n') {
        flat.push('\n')
        lastSpace = true
        return s
      }
      let t = s.replace(/[ \t\r\n\f]+/g, ' ')
      if (lastSpace && t.startsWith(' ')) t = t.slice(1)
      if (t) lastSpace = t.endsWith(' ')
      return t
    }
    if (s && typeof s === 'object') {
      const key = s.sup !== undefined ? 'sup' : s.sub !== undefined ? 'sub' : 'text'
      const inner = Array.isArray(s[key]) ? s[key].map(walk).filter((x) => x !== '') : walk(s[key])
      return { ...s, [key]: inner }
    }
    return s
  }
  for (const s of spans) {
    const r = walk(s)
    if (r !== '' && !(Array.isArray(r) && !r.length)) flat.push(r)
  }
  // Trim the trailing space.
  for (let i = flat.length - 1; i >= 0; i--) {
    if (typeof flat[i] === 'string') {
      flat[i] = flat[i].replace(/ +$/, '')
      if (flat[i] === '') {
        flat.splice(i, 1)
        continue
      }
    }
    break
  }
  if (flat.every((s) => typeof s === 'string' && !s.trim())) return []
  return flat
}
