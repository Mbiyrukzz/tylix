// A small, forgiving XML / HTML parser -> { tag, attrs, children } with
// strings for text. HTML mode knows void elements and closes <p>, <li>,
// <td>, <tr>… implicitly.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const AUTO_CLOSE = {
  p: new Set(['p', 'div', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'section', 'header', 'footer']),
  li: new Set(['li']),
  td: new Set(['td', 'th', 'tr']),
  th: new Set(['td', 'th', 'tr']),
  tr: new Set(['tr', 'tbody', 'tfoot']),
  thead: new Set(['tbody', 'tfoot']),
  tbody: new Set(['tbody', 'tfoot']),
  option: new Set(['option']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', times: '×', divide: '÷', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', shy: '­', zwsp: '​' }

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

export function parseMarkup(src, { html = false } = {}) {
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      pushText(src.slice(i))
      break
    }
    if (lt > i) pushText(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt)
      top().children.push(src.slice(lt + 9, end === -1 ? n : end))
      i = end === -1 ? n : end + 3
      continue
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt)
      i = end === -1 ? n : end + 1
      continue
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt)
      let tag = src.slice(lt + 2, end === -1 ? n : end).trim()
      if (html) tag = tag.toLowerCase()
      // Close up to the matching element (ignore stray closers).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k
          break
        }
      }
      i = end === -1 ? n : end + 1
      continue
    }
    // Opening tag.
    const m = /^<([a-zA-Z][\w:.-]*)/.exec(src.slice(lt, lt + 64))
    if (!m) {
      pushText('<')
      i = lt + 1
      continue
    }
    let tag = html ? m[1].toLowerCase() : m[1]
    let p = lt + m[0].length
    const attrs = {}
    const attrRe = /\s*([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y
    for (;;) {
      attrRe.lastIndex = p
      const a = attrRe.exec(src)
      if (!a || !a[0].trim()) break
      const name = html ? a[1].toLowerCase() : a[1]
      attrs[name] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
      p = attrRe.lastIndex
    }
    while (p < n && /\s/.test(src[p])) p++
    let selfClose = false
    if (src[p] === '/') {
      selfClose = true
      p++
    }
    if (src[p] === '>') p++
    if (html) {
      // Implicit closes (a new <li> ends the previous one, etc.).
      for (let k = stack.length - 1; k > 0; k--) {
        const open = stack[k].tag
        if (AUTO_CLOSE[open]?.has(tag)) {
          stack.length = k
          break
        }
        if (['ul', 'ol', 'table', 'div', 'td', 'th', 'blockquote'].includes(open)) break
      }
    }
    const el = { tag, attrs, children: [] }
    top().children.push(el)
    i = p
    if (selfClose || (html && VOID.has(tag))) continue
    if (html && (tag === 'script' || tag === 'style' || tag === 'textarea')) {
      const end = src.toLowerCase().indexOf(`</${tag}`, i)
      el.children.push(src.slice(i, end === -1 ? n : end))
      const close = end === -1 ? n : src.indexOf('>', end)
      i = close === -1 ? n : close + 1
      continue
    }
    stack.push(el)
  }
  return root

  function pushText(text) {
    if (text) top().children.push(decodeEntities(text))
  }
}

export function textContent(node) {
  if (typeof node === 'string') return node
  return node.children.map(textContent).join('')
}

// Inline style attribute -> { prop: value }.
export function parseStyle(text) {
  const out = {}
  if (!text) return out
  for (const decl of text.split(';')) {
    const c = decl.indexOf(':')
    if (c < 0) continue
    out[decl.slice(0, c).trim().toLowerCase()] = decl.slice(c + 1).trim().replace(/\s*!important$/, '')
  }
  return out
}

// Minimal CSS: rules with type / .class / #id compound selectors and
// descendant combinators. Pseudo-classes and other combinators make a
// rule not apply (it's for interactive states that don't exist on paper).
export function parseCss(text) {
  const rules = []
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  let order = 0
  while ((m = re.exec(clean))) {
    const decls = parseStyle(m[2])
    for (const sel of m[1].split(',')) {
      const s = sel.trim()
      if (!s || /[:>+~[\]*]/.test(s) || s.startsWith('@')) continue
      const parts = s.split(/\s+/).map(parseCompound)
      const spec = parts.reduce((acc, p) => acc + (p.id ? 100 : 0) + p.classes.length * 10 + (p.tag ? 1 : 0), 0)
      rules.push({ parts, decls, spec, order: order++ })
    }
  }
  return rules.sort((a, b) => a.spec - b.spec || a.order - b.order)
}

function parseCompound(text) {
  const tag = /^[a-zA-Z][\w-]*/.exec(text)?.[0]?.toLowerCase()
  const id = /#([\w-]+)/.exec(text)?.[1]
  const classes = [...text.matchAll(/\.([\w-]+)/g)].map((x) => x[1])
  return { tag, id, classes }
}

function matchCompound(el, c) {
  if (c.tag && el.tag.toLowerCase() !== c.tag) return false
  if (c.id && el.attrs.id !== c.id) return false
  if (c.classes.length) {
    const list = (el.attrs.class || '').split(/\s+/)
    if (!c.classes.every((k) => list.includes(k))) return false
  }
  return true
}

// Declarations that apply to el (ancestors: nearest last).
export function matchCss(rules, el, ancestors) {
  const out = {}
  for (const rule of rules) {
    const parts = rule.parts
    if (!matchCompound(el, parts[parts.length - 1])) continue
    let k = parts.length - 2
    for (let a = ancestors.length - 1; a >= 0 && k >= 0; a--) if (matchCompound(ancestors[a], parts[k])) k--
    if (k < 0) Object.assign(out, rule.decls)
  }
  return out
}
