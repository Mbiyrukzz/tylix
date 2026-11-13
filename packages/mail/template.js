// Mail templates: HTML (and optional text) files with placeholders.
//
//   {{ name }}            value, HTML-escaped
//   {{ user.name }}       dotted paths
//   {{{ html }}}          value inserted as-is (trusted HTML only)
//   {{#if cond}}…{{#else}}…{{/if}}
//   {{#each items}}…{{ this.title }} {{ @index }}…{{/each}}
//
// A placeholder whose value is missing (undefined) throws, so a typo in
// a template fails loudly instead of mailing "undefined" to a customer.
import fs from 'node:fs/promises'
import path from 'node:path'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])
}

function lookup(scopes, expr, template) {
  const parts = expr.split('.')
  for (const scope of scopes) {
    if (scope == null || typeof scope !== 'object') continue
    if (parts[0] === 'this') return dig(scope.this, parts.slice(1), expr)
    if (parts[0] in scope) return dig(scope, parts, expr)
  }
  throw new Error(`Mail template variable "${expr}" was not provided in data${template ? ` (${template})` : ''}.`)
}

function dig(value, parts, expr) {
  let v = value
  for (const p of parts) {
    if (v == null) return undefined
    v = v[p]
  }
  return v
}

// Finds the {{/name}} that closes the block opened just before `from`,
// skipping nested blocks of the same kind.
function findClose(src, name, from) {
  const re = new RegExp(`\\{\\{\\s*(#${name}\\b|/${name}\\s*\\}\\})`, 'g')
  re.lastIndex = from
  let depth = 1
  for (let m; (m = re.exec(src)); ) {
    depth += m[1].startsWith('#') ? 1 : -1
    if (depth === 0) return { start: m.index, end: m.index + m[0].length }
  }
  throw new Error(`Unclosed {{#${name}}} in mail template`)
}

// {{#else}} at the top level of an if-block body.
function splitElse(body) {
  const re = /\{\{\s*(#if\b|\/if\s*\}\}|#else\s*\}\})/g
  let depth = 0
  for (let m; (m = re.exec(body)); ) {
    if (m[1].startsWith('#if')) depth++
    else if (m[1].startsWith('/if')) depth--
    else if (depth === 0) return [body.slice(0, m.index), body.slice(m.index + m[0].length)]
  }
  return [body, '']
}

function renderWith(src, scopes, name) {
  let out = ''
  let i = 0
  const tag = /\{\{\{\s*([\w$.@]+)\s*\}\}\}|\{\{\s*(#if|#each)\s+([\w$.@]+)\s*\}\}|\{\{\s*([\w$.@]+)\s*\}\}/g
  for (let m; (m = tag.exec(src.slice(i))); ) {
    const at = i + m.index
    out += src.slice(i, at)
    const after = at + m[0].length
    if (m[1]) {
      out += String(lookup(scopes, m[1], name) ?? '')
      i = after
    } else if (m[2]) {
      const kind = m[2].slice(1)
      const close = findClose(src, kind, after)
      const body = src.slice(after, close.start)
      const value = lookup(scopes, m[3], name)
      if (kind === 'if') {
        const [yes, no] = splitElse(body)
        const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value)
        out += renderWith(truthy ? yes : no, scopes, name)
      } else {
        const list = value == null ? [] : Array.from(value)
        list.forEach((item, index) => {
          const frame = { this: item, '@index': index }
          out += renderWith(body, [frame, item, ...scopes], name)
        })
      }
      i = close.end
    } else {
      const v = lookup(scopes, m[4], name)
      if (v === undefined) {
        throw new Error(`Mail template variable "${m[4]}" was not provided in data${name ? ` (${name})` : ''}.`)
      }
      out += escapeHtml(v ?? '')
      i = after
    }
    tag.lastIndex = 0
  }
  return out + src.slice(i)
}

export function renderTemplate(template, data = {}, name = '') {
  return renderWith(template, [data], name)
}

// The default view loader: `<dir>/<view>.html` and, when it exists,
// `<dir>/<view>.txt` for the plain-text part.
//   createViewRenderer('resources/mail')('welcome', { name: 'Ada' })
//   -> { html, text? }
export function createViewRenderer(dir) {
  return async function render(view, data) {
    if (/[\\/]\.\.|^\.\./.test(view)) throw new Error(`Invalid mail view "${view}"`)
    const base = path.resolve(dir, view)
    const html = renderTemplate(await fs.readFile(`${base}.html`, 'utf-8'), data, `${view}.html`)
    let text
    try {
      text = renderTemplate(await fs.readFile(`${base}.txt`, 'utf-8'), data, `${view}.txt`)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    return { html, text }
  }
}
