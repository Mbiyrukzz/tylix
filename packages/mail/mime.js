// Builds RFC 5322 / MIME messages. Used by the SMTP and Amazon SES
// transports (both take a raw message) and by preview().
//
//   const { raw, envelope } = await buildMime(normalizeMessage(message))
//
// Layout, outermost first, only as deep as the message needs:
//   multipart/mixed        when there are regular attachments
//   multipart/related      when there are inline images (cid)
//   multipart/alternative  text + html
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------- checks

// Any CR or LF in a header value would let the caller add headers of
// their own (or extra SMTP commands, for the envelope addresses).
export function assertNoLineBreaks(value, label) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}: line breaks are not allowed`)
  }
  return value
}

// ------------------------------------------------------------- addresses

// Accepts "ada@example.com", "Ada Lovelace <ada@example.com>" or
// { name, address } and returns { name, address }.
export function parseAddress(input, label = 'address') {
  let name = ''
  let address
  if (input && typeof input === 'object') {
    name = input.name ?? ''
    address = input.address ?? input.email
  } else if (typeof input === 'string') {
    const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(input)
    if (m) {
      name = m[1].replace(/^"(.*)"$/, '$1')
      address = m[2]
    } else {
      address = input.trim()
    }
  }
  if (typeof address !== 'string') throw new Error(`Invalid ${label}: missing email address`)
  assertNoLineBreaks(address, label)
  assertNoLineBreaks(name, `${label} name`)
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) {
    throw new Error(`Invalid ${label}: "${address}" is not an email address`)
  }
  return { name, address }
}

export function parseAddressList(input, label) {
  if (input == null || input === '') return []
  return [].concat(input).map((a) => parseAddress(a, label))
}

export function formatAddress({ name, address }) {
  if (!name) return address
  // Letters, digits and spaces go as they are; other printable ASCII
  // (dots, commas, quotes...) is quoted; anything else is encoded.
  if (/^[A-Za-z0-9 ]*$/.test(name)) return `${name} <${address}>`
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>`
  return `${encodeHeaderValue(name)} <${address}>`
}

// ---------------------------------------------------------------- encoding

// RFC 2047: non-ASCII header text is sent as encoded words. Each word
// stays under the 75-character limit, and multi-byte characters are
// never split across words.
export function encodeHeaderValue(value) {
  assertNoLineBreaks(value, 'header value')
  if (/^[\x20-\x7e]*$/.test(value)) return value

  const words = []
  let chunk = ''
  let bytes = 0
  for (const ch of value) {
    const size = Buffer.byteLength(ch)
    if (bytes + size > 45) {
      words.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += ch
    bytes += size
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ')
}

// Base64 body parts need no line-ending normalisation or dot-stuffing:
// the encoded text only has A-Z a-z 0-9 + / = and is wrapped at 76.
function base64Lines(value) {
  const encoded = Buffer.from(value).toString('base64')
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n')
}

// RFC 2231 filename for non-ASCII names, plain quoted otherwise.
function filenameParam(name) {
  if (/^[\x20-\x7e]*$/.test(name)) return `filename="${name.replace(/(["\\])/g, '\\$1')}"`
  return `filename*=UTF-8''${encodeURIComponent(name)}`
}

// Rough plain-text version of an HTML body, so the text part is never
// empty and clients that prefer text show something readable.
export function htmlToText(html) {
  return String(html)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return text && text !== href ? `${text} (${href})` : href
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h[1-6]>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ------------------------------------------------------------ attachments

const TYPES = {
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json',
  csv: 'text/csv', txt: 'text/plain', html: 'text/html', ics: 'text/calendar',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml',
  doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function contentTypeFor(filename) {
  const ext = path.extname(filename ?? '').slice(1).toLowerCase()
  return TYPES[ext] ?? 'application/octet-stream'
}

// Reads `path` attachments and fills in filename / contentType, giving
//   { filename, content: Buffer, contentType, cid? }
export async function loadAttachments(list = []) {
  return Promise.all(
    list.map(async (a, i) => {
      if (!a || typeof a !== 'object') throw new Error(`Invalid attachment #${i + 1}`)
      let content = a.content
      if (content == null && a.path) content = await fs.readFile(a.path)
      if (content == null) throw new Error(`Attachment #${i + 1} needs content or path`)
      // Documents that render themselves (@tylix/pdf, @tylix/excel).
      if (typeof content.toBuffer === 'function') content = await content.toBuffer()
      if (typeof content === 'string') {
        content = a.encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content)
      } else if (!Buffer.isBuffer(content)) {
        content = Buffer.from(content)
      }
      const filename = a.filename ?? (a.path ? path.basename(a.path) : `attachment-${i + 1}`)
      assertNoLineBreaks(filename, 'attachment filename')
      if (a.cid != null) assertNoLineBreaks(String(a.cid), 'attachment cid')
      return {
        filename,
        content,
        contentType: a.contentType ?? contentTypeFor(filename),
        cid: a.cid ?? null,
      }
    }),
  )
}

// ---------------------------------------------------------------- message

// Turns what the caller passed into one consistent shape. Throws on
// anything that cannot be sent, before any connection is made.
export function normalizeMessage(message, defaults = {}) {
  const m = { ...defaults, ...message }
  const from = parseAddress(m.from, 'from address')
  const to = parseAddressList(m.to, 'to address')
  const cc = parseAddressList(m.cc, 'cc address')
  const bcc = parseAddressList(m.bcc, 'bcc address')
  if (to.length + cc.length + bcc.length === 0) throw new Error('A message needs at least one recipient')
  const replyTo = parseAddressList(m.replyTo, 'replyTo address')
  const subject = assertNoLineBreaks(m.subject ?? '', 'subject')
  const headers = {}
  for (const [k, v] of Object.entries(m.headers ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(k)) throw new Error(`Invalid header name "${k}"`)
    headers[k] = assertNoLineBreaks(String(v), `header ${k}`)
  }
  const html = m.html ?? ''
  const text = m.text ?? (html ? htmlToText(html) : '')
  return {
    from, to, cc, bcc, replyTo, subject, html, text, headers,
    attachments: m.attachments ?? [],
    tags: m.tags ?? {},
  }
}

function boundary() {
  return `tylix-${crypto.randomBytes(12).toString('hex')}`
}

function textPart(type, body) {
  return [`Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(body)].join('\r\n')
}

function attachmentPart(a, inline) {
  const lines = [
    `Content-Type: ${a.contentType}; name="${a.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${inline ? 'inline' : 'attachment'}; ${filenameParam(a.filename)}`,
  ]
  if (inline) lines.push(`Content-ID: <${a.cid}>`)
  lines.push('', base64Lines(a.content))
  return lines.join('\r\n')
}

function multipart(type, parts) {
  const b = boundary()
  return [
    `Content-Type: multipart/${type}; boundary="${b}"`,
    '',
    ...parts.flatMap((p) => [`--${b}`, p]),
    `--${b}--`,
  ].join('\r\n')
}

// { raw, envelope: { from, to[] }, messageId } for a normalized message
// whose attachments are already loaded (loadAttachments).
export function buildMime(msg, { date = new Date(), messageId } = {}) {
  const domain = msg.from.address.split('@')[1]
  const id = messageId ?? `<${crypto.randomUUID()}@${domain}>`

  const headers = [
    `From: ${formatAddress(msg.from)}`,
    msg.to.length ? `To: ${msg.to.map(formatAddress).join(', ')}` : null,
    msg.cc.length ? `Cc: ${msg.cc.map(formatAddress).join(', ')}` : null,
    // Bcc recipients are only in the envelope, never in the headers.
    msg.replyTo.length ? `Reply-To: ${msg.replyTo.map(formatAddress).join(', ')}` : null,
    `Subject: ${encodeHeaderValue(msg.subject)}`,
    // RFC 5322 date, with a numeric zone instead of "GMT".
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    ...Object.entries(msg.headers).map(([k, v]) => `${k}: ${encodeHeaderValue(v)}`),
  ].filter(Boolean)

  const inline = msg.attachments.filter((a) => a.cid)
  const regular = msg.attachments.filter((a) => !a.cid)

  let body = msg.html
    ? multipart('alternative', [textPart('text/plain', msg.text), textPart('text/html', msg.html)])
    : textPart('text/plain', msg.text)
  if (inline.length) body = multipart('related', [body, ...inline.map((a) => attachmentPart(a, true))])
  if (regular.length) body = multipart('mixed', [body, ...regular.map((a) => attachmentPart(a, false))])

  return {
    raw: `${headers.join('\r\n')}\r\n${body}\r\n`,
    messageId: id,
    envelope: {
      from: msg.from.address,
      to: [...msg.to, ...msg.cc, ...msg.bcc].map((a) => a.address),
    },
  }
}
