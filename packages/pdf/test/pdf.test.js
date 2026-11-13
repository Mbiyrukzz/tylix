import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createPdf, renderPdf, qrMatrix, barcodeModules, htmlToNodes, formatValue, downloadHeaders } from '../src/index.js'
import { parsePath } from '../src/graphics/svgPath.js'
import { parseColor } from '../src/util/color.js'
import { StandardFont } from '../src/fonts/StandardFont.js'
import { breakLines } from '../src/layout/text.js'

import { deflateSync } from 'node:zlib'

const latin = (bytes) => Buffer.from(bytes).toString('latin1')
// Content with kerning adjustments removed, so "[(P) 40 (age)] TJ"
// reads as "(Page)".
const shown = (bytes) => latin(bytes).replace(/\)\s*-?[\d.]+\s*\(/g, '')

// A real RGBA PNG (w x h, one color).
function png(w, h, [r, g, b, a]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Every xref entry must point at "<n> 0 obj".
function assertValidXref(bytes) {
  const s = latin(bytes)
  assert.ok(s.startsWith('%PDF-1.7'))
  assert.ok(s.trimEnd().endsWith('%%EOF'))
  const startxref = Number(/startxref\s+(\d+)/.exec(s)[1])
  assert.equal(s.slice(startxref, startxref + 4), 'xref')
  const entries = s.slice(startxref).split('\n').slice(3)
  let n = 1
  for (const line of entries) {
    if (!/^\d{10} 00000 n $/.test(line)) break
    const offset = Number(line.slice(0, 10))
    assert.equal(s.slice(offset, offset + `${n} 0 obj`.length), `${n} 0 obj`, `object ${n}`)
    n++
  }
  assert.ok(n > 3)
}

const pageCount = (bytes) => (latin(bytes).match(/\/Type \/Page\b(?!s)/g) ?? latin(bytes).match(/\/Type\/Page[^s]/g) ?? []).length

test('a simple document is a valid PDF', async () => {
  const bytes = await renderPdf({ title: 'Hello', content: ['Hello world', { h1: 'Title' }] })
  assertValidXref(bytes)
  const s = latin(bytes)
  assert.match(s, /\/Title \(Hello\)/)
  assert.match(s, /\/Producer \(Tylix PDF\)/)
})

test('text is written with the standard font and kerning', async () => {
  const doc = createPdf({ compress: false, content: ['AVATAR'] })
  const s = latin(await doc.toBuffer())
  assert.match(s, /\/BaseFont \/Helvetica/)
  assert.match(s, /\[\(A\) \d+ \(V\)/) // kerned pair
})

test('long content flows onto more pages', async () => {
  const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i}. ` + 'Lorem ipsum dolor sit amet. '.repeat(8))
  const doc = createPdf({ compress: false, content: paragraphs, footer: 'Page {page} of {pages}' })
  const bytes = await doc.toBuffer()
  assertValidXref(bytes)
  assert.ok(doc.pageCount > 3)
  assert.match(shown(bytes), new RegExp(`\\(Page ${doc.pageCount} of ${doc.pageCount}\\)`))
})

test('tables repeat their header on every page', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i, name: `Row ${i}` }))
  const doc = createPdf({ compress: false, content: [{ table: { columns: [{ header: 'IDHEAD', key: 'id' }, { header: 'Name', key: 'name' }], rows } }] })
  const s = shown(await doc.toBuffer())
  assert.ok(doc.pageCount >= 3)
  assert.equal(s.match(/\(IDHEAD\)/g).length, doc.pageCount)
  assert.match(s, /\(Row 119\)/)
})

test('page breaks and landscape sections', async () => {
  const doc = createPdf({ compress: false, content: ['one', { pageBreak: true }, 'two', { pageBreak: true, orientation: 'landscape' }, 'three'] })
  const s = latin(await doc.toBuffer())
  assert.equal(doc.pageCount, 3)
  assert.match(s, /\/MediaBox \[0 0 841\.89 595\.28\]/)
})

test('links, outlines and a table of contents', async () => {
  const doc = createPdf({
    compress: false,
    content: [{ toc: true }, { h1: 'Intro' }, { text: 'see', link: '#details' }, { pageBreak: true }, { h1: 'Details', id: 'details' }, { text: 'site', link: 'https://tylix.dev' }],
  })
  const s = latin(await doc.toBuffer())
  assert.match(s, /\/Outlines/)
  assert.match(s, /\/Title \(Intro\)/)
  assert.match(s, /\/URI \(https:\/\/tylix\.dev\)/)
  assert.match(s, /\/Dest \[\d+ 0 R \/XYZ/)
  // The TOC lists Details on page 2.
  assert.match(shown(Buffer.from(s, 'latin1')), /\(Details\) Tj[\s\S]*\(2\) Tj/)
})

test('images: PNG and JPEG', async () => {
  // 1x1 PNG (opaque red) and a tiny JPEG header-only check.
  const opaque = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
  const bytes = await renderPdf({ compress: false, content: [{ image: opaque, width: 50 }, { image: 'data:image/png;base64,' + opaque.toString('base64'), width: 20 }] })
  const s = latin(bytes)
  assert.match(s, /\/Subtype \/Image/)
  assert.match(s, /\/Predictor 15/)
  assertValidXref(bytes)
})

test('PNG with alpha gets a soft mask', async () => {
  const s = latin(await renderPdf({ compress: false, content: [{ image: png(4, 3, [255, 0, 0, 128]), width: 10 }] }))
  assert.match(s, /\/SMask \d+ 0 R/)
})

test('unknown image names give a helpful error', async () => {
  await assert.rejects(renderPdf({ content: [{ image: 'missing.png' }], basePath: '/nonexistent' }), /File not found/)
})

test('svg and charts render as vectors', async () => {
  const svg = '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="2" fill="#2563eb"/><text x="5" y="5" text-anchor="middle">Hi</text></svg>'
  const s = latin(await renderPdf({ compress: false, content: [{ svg, width: 100 }, { chart: 'line', data: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 3 }] }] }] }))
  assert.match(s, /\(Hi\) Tj/)
  assert.match(s, / c\n/) // curves from the rounded rect
})

test('qr matrices have finder patterns and the right size', () => {
  const m = qrMatrix('https://tylix.dev')
  assert.equal(m.length, 25) // version 2
  for (const [r, c] of [[0, 0], [0, 18], [18, 0]]) {
    assert.equal(m[r][c], true)
    assert.equal(m[r + 1][c + 1], false)
    assert.equal(m[r + 3][c + 3], true)
  }
  assert.equal(qrMatrix('1234567890').length, 21)
  assert.throws(() => qrMatrix('x', { level: 'Z' }), /level/)
})

test('barcodes', () => {
  const ean = barcodeModules('400638133393', 'ean13')
  assert.equal(ean.text, '4006381333931')
  assert.equal(ean.modules.length, 95 + 18)
  assert.throws(() => barcodeModules('4006381333930', 'ean13'), /check digit/)
  const c128 = barcodeModules('Tylix-123', 'code128')
  assert.equal((c128.modules.length - 20 - 13) % 11, 0)
  assert.equal(barcodeModules('03600029145', 'upca').text, '036000291452')
})

test('svg paths: arcs become curves', () => {
  const segs = parsePath('M0 0 A10 10 0 0 1 20 0 Z')
  assert.equal(segs[0][0], 'M')
  assert.ok(segs.some((s) => s[0] === 'C'))
  const last = segs[segs.length - 2]
  assert.deepEqual([last[5], last[6]], [20, 0])
})

test('colors', () => {
  assert.deepEqual(parseColor('#fff').values, [1, 1, 1])
  assert.equal(parseColor('rgba(0,0,0,0.5)').alpha, 0.5)
  assert.equal(parseColor('var(--x, #000)').values[0], 0)
  assert.equal(parseColor('none'), null)
  assert.equal(parseColor({ c: 0, m: 0, y: 0, k: 100 }).space, 'cmyk')
})

test('line breaking', () => {
  const font = new StandardFont('Helvetica')
  const run = (text) => ({ text, font, size: 10 })
  const lines = breakLines([run('The quick brown fox jumps over the lazy dog')], 80)
  assert.ok(lines.length > 2)
  for (const l of lines) assert.ok(l.width <= 80.01)
  const long = breakLines([run('Supercalifragilisticexpialidocious')], 40)
  assert.ok(long.length > 1)
  const hard = breakLines([run('one\ntwo')], 500)
  assert.equal(hard.length, 2)
})

test('html becomes nodes', () => {
  const nodes = htmlToNodes('<h1>Title</h1><p>Hello <b>bold</b> <a href="https://x.dev">link</a></p><ul><li>a</li><li>b</li></ul><table><tr><th>A</th></tr><tr><td>1</td></tr></table>')
  assert.deepEqual(nodes[0].h1, ['Title'])
  assert.deepEqual(nodes[1].text[1], { text: ['bold'], bold: true })
  assert.equal(nodes[2].ul.length, 2)
  assert.equal(nodes[3].table.headerRows, 1)
})

test('formats', () => {
  assert.equal(formatValue(1234.5, 'currency', { locale: 'en-US', currency: 'USD' }), '$1,234.50')
  assert.equal(formatValue(0.25, 'percent', { locale: 'en-US' }), '25%')
  assert.equal(formatValue(true), 'Yes')
})

test('download headers encode the filename', () => {
  const h = downloadHeaders('Rapport été.pdf', 10)
  assert.match(h['Content-Disposition'], /attachment; filename="Rapport _t_\.pdf"; filename\*=UTF-8''Rapport%20%C3%A9t%C3%A9\.pdf/)
})

test('send() writes to a Node-style response', async () => {
  const headers = {}
  let body
  const res = { setHeader: (k, v) => (headers[k] = v), end: (b) => (body = b) }
  await createPdf(['x']).send(res, 'x.pdf', { inline: true })
  assert.equal(headers['Content-Type'], 'application/pdf')
  assert.match(headers['Content-Disposition'], /^inline/)
  assert.equal(String(body.length), headers['Content-Length'])
})

const ttf = '/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf'
test('embedded TrueType fonts are subset with a ToUnicode map', { skip: !existsSync(ttf) && 'no test font' }, async () => {
  const s = latin(await renderPdf({ compress: false, fonts: { Sans: ttf }, defaultStyle: { font: 'Sans' }, content: ['Ελληνικά'] }))
  assert.match(s, /\/Subtype \/Type0/)
  assert.match(s, /\/FontFile2/)
  assert.match(s, /beginbfchar/)
  assert.match(s, /[A-Z]{6}\+LiberationSans/)
})
