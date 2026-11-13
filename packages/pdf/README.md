# @tylix/pdf

PDF documents from plain JavaScript objects. You describe the content,
and it lays out pages, wraps text, breaks tables across pages and
numbers the pages. It runs in Node, Deno, Bun, edge runtimes and the
browser, with no dependencies.

```sh
npm install @tylix/pdf
```

```js
import { createPdf } from '@tylix/pdf'

const pdf = createPdf({
  title: 'Invoice #1042',
  pageNumbers: true,
  content: [
    { h1: 'Invoice #1042' },
    { text: ['Billed to ', { text: 'Ada Lovelace', bold: true }] },
    {
      table: {
        columns: [
          { header: 'Item', key: 'name', width: '*' },
          { header: 'Qty', key: 'qty' },
          { header: 'Price', key: 'price', format: 'currency' },
        ],
        rows: items, // your objects, as they are
        zebra: true,
      },
    },
    { qr: 'https://acme.dev/pay/1042', size: 72, align: 'right' },
  ],
})

await pdf.save('invoice.pdf')
```

## Why use it

- **Objects in, PDF out.** Pass your rows to `table` as they are. Columns
  pick fields by `key` and format currency, dates and percentages for you.
- **Pages are handled for you.** Text wraps and flows across pages.
  Tables repeat their header on every page. Headings stay with the
  paragraph that follows them, and paragraphs avoid leaving a single
  line alone at the top or bottom of a page.
- **Good defaults.** Readable type, spacing between blocks, styled table
  headers and bullet markers, without any configuration.
- **Unicode.** Embed any TrueType font (subset to the characters you use)
  and add fallback fonts for scripts the main font lacks (CJK, Greek,
  Cyrillic…). The text stays searchable and copyable.
- **Vector graphics.** SVG, `@tylix/charts`, QR codes and barcodes stay
  sharp at any zoom.
- **HTML too.** Render the HTML from an email template or a CMS as a PDF.
- **Runs anywhere.** It uses only web-standard APIs (no `fs` unless you
  load files by path), so the same code works on a server, in an edge
  function or in the browser.

## Output

```js
await pdf.toBuffer()          // Buffer in Node, Uint8Array elsewhere
await pdf.save('out.pdf')     // Node, Deno, Bun
await pdf.send(res, 'a.pdf')  // Node / Express / Tylix response
await pdf.toResponse('a.pdf') // fetch Response: Hono, Next.js routes, Workers
await pdf.toBlob()            // browser
await pdf.download('a.pdf')   // browser: save as a file
await pdf.open()              // browser: open in a new tab
await pdf.toDataUrl()
```

`send`, `toResponse` and `download` set the Content-Type and a
Content-Disposition header that keeps non-ASCII file names intact. Pass
`{ inline: true }` to show the PDF in the browser instead of downloading it.

## In Tylix

```js
import { createPdf } from '@tylix/pdf'

router.get('/invoices/:id/pdf', async (req, res) => {
  const invoice = await Invoice.find(req.params.id)
  await res.download(invoicePdf(invoice), `invoice-${invoice.number}.pdf`)
})

// As a mail attachment: @tylix/mail renders it for you.
await mailer.send({
  to: customer.email,
  subject: 'Your invoice',
  view: 'invoice',
  attachments: [{ filename: 'invoice.pdf', content: invoicePdf(invoice) }],
})
```

`tylix make:pdf Invoice` creates `app/pdfs/InvoicePdf.js` to start from.
In the browser, `.tyx` pages can import the package from `/_tylix/pdf/index.js`.

## Content

`content` is a list of nodes. A string is a paragraph, and an array is a
stack of nodes.

### Text

```js
'A plain paragraph.'
{ text: 'Centered and muted', align: 'center', style: 'muted' }
{ text: ['Mixed ', { text: 'bold', bold: true }, ', ', { text: 'red', color: '#dc2626' }, ' and ', { text: 'a link', link: 'https://tylix.dev' }] }
{ text: ['H', { sub: '2' }, 'O and E = mc', { sup: '2' }] }
{ text: 'Justified text…', align: 'justify' }
{ h1: 'Title' } … { h6: 'Smallest' }
```

Text properties: `font`, `size`, `bold`, `italic`, `color`,
`lineHeight`, `align`, `characterSpacing`, `underline`, `strike`,
`background` (on spans: a highlight), `opacity` and `link` (a URL,
`mailto:`, or `#id` for another node). Children inherit them.

Lines break at spaces, after hyphens and slashes, at soft hyphens
(`­`, shown as a hyphen only when the line breaks there), between
CJK characters and at `​`. A word wider than the line is split
between characters.

### Lists

```js
{ ul: ['One', 'Two', ['Three', { ul: ['Nested'] }]] }
{ ol: ['First', 'Second'], type: 'lower-alpha', start: 3 }
{ ul: ['Done', 'Shipped'], type: 'check', markerColor: '#16a34a' }
```

Bullet types are `disc`, `circle`, `square`, `dash`, `check` and `none`.
Numbered lists can be `decimal`, `lower-alpha`, `upper-alpha`,
`lower-roman` or `upper-roman`.

### Tables

```js
{
  table: {
    columns: [
      { header: '#', key: 'id', width: 40 },
      { header: 'Customer', key: 'customer.name', width: '*' }, // nested keys work
      { header: 'Date', key: 'date', format: 'date' },
      { header: 'Total', key: 'total', format: 'currency', footer: (rows) => sum(rows, 'total') },
      { header: 'Status', value: (row) => ({ text: row.status, color: row.paid ? '#16a34a' : '#dc2626' }) },
    ],
    rows: orders,
    zebra: true,          // or a color
    borders: 'horizontal', // 'grid' | 'outer' | 'none'
    radius: 6,            // rounded frame with grid/outer
    emptyText: 'No orders yet',
  },
}
```

- **Widths:** a number of points, a percentage like `'25%'`, `'*'` or
  `'2*'` to share the leftover space, or `'auto'` (the default) to size
  the column to its content.
- **Formats:** `currency`, `number`, `integer`, `decimal`, `percent`,
  `date`, `datetime`, `time`, or a function `(value, row) => content`.
  They follow the document's `locale`, `currency` and `timeZone`. Number
  columns are right-aligned automatically.
- **Cells:** any content (images, lists, nested tables), or
  `{ content, colSpan, background, align, valign }`.
- **Other row formats:** without `columns`, `rows` can be arrays (use
  `headers: [...]` or `headerRows: 1` for a header). Plain objects work
  too: their keys become the headers.
- **Footers:** `footer: [...]` adds totals rows.
- **Page breaks:** the header repeats on every page (`repeatHeader:
  false` turns that off). Rows taller than a page are split across
  pages; `dontBreakRows: true` keeps each row on one page.

### Layout

```js
{ columns: [{ image: 'logo', width: 60 }, { stack: ['Acme Inc.', 'Nairobi'], width: '*' }, { text: 'INVOICE', align: 'right' }], gap: 16 }
{ box: ['A callout'], padding: 12, background: '#eff6ff', border: 1, borderColor: '#bfdbfe', radius: 6 }
{ hr: true }  { spacer: 24 }  { pageBreak: true }
{ pageBreak: true, orientation: 'landscape' } // the following pages are landscape
```

Every node takes `margin`, `padding`, `background`, `border`,
`borderColor`, `radius`, `width`, `blockAlign`, `id`,
`pageBreak: 'before' | 'after'`, `unbreakable` (moves to the next page
instead of splitting) and `keepWithNext`. Boxes and columns split across
pages like everything else. `absolute: [x, y]` places a node at a fixed
spot on the page, outside the flow (for stamps and signatures).

### Images, SVG, charts

```js
{ image: './logo.png', width: 120 }                 // path, URL, data: URL or bytes
{ image: 'logo', fit: [200, 100], align: 'center' } // a name from `images`
{ image: photo, width: 200, radius: 8, opacity: 0.8 }
{ svg: '<svg viewBox="0 0 24 24">…</svg>', width: 24 }
{ chart: 'line', data: series, height: 220 }        // needs @tylix/charts
```

- **Images:** JPEG (embedded as is, phone-photo rotation from EXIF
  applied) and PNG (including transparency, palettes and interlacing).
  A named image used on many pages is stored once.
- **SVG:** paths, shapes, text, groups, transforms, gradients, opacity,
  dashes, simple `<style>` rules and embedded images.
- **Charts:** any `@tylix/charts` type (`line`, `area`, `bar`, `pie`,
  `donut`, `scatter`, `gauge`, `heatmap`, `sparkline`), with `options`
  passed through. They're drawn as vectors.

### QR codes and barcodes

```js
{ qr: 'https://tylix.dev', size: 96, level: 'M' }    // L, M, Q, H; any text incl. Unicode
{ barcode: 'TYLIX-12345' }                           // Code 128
{ barcode: '400638133393', type: 'ean13', height: 40 } // ean13, upca, ean8, code39
```

### HTML

```js
{ html: '<h2>Terms</h2><p>Payment is due in <b>30 days</b>.</p><ul><li>…</li></ul>' }
```

Supported tags:

- **Blocks:** headings, paragraphs, `div`, `section`, `blockquote`, `pre`.
- **Inline:** `b`, `i`, `u`, `s`, `a`, `code`, `mark`, `sub`, `sup`, `br`.
- **Lists:** `ul`, `ol`, `li`, `dl`.
- **Tables:** `table` with `thead`, `tfoot` and `colspan`.
- **Other:** `img`, `hr`.

Inline `style=""` supports the common properties: color, background,
font size, weight and style, alignment, margins, padding, borders and
page breaks. A `class` that matches one of your `styles` uses that style.
Use it to turn your email templates into PDFs.

### Drawing

```js
{
  canvas: (p, { x, y, width, height }) => {
    p.roundedRect(x, y, width, height, 8).fill({ type: 'linear', stops: [{ offset: 0, color: '#6366f1' }, { offset: 1, color: '#ec4899' }] })
    p.text('Signed', x + 12, y + 12, { size: 14, color: '#fff', bold: true })
  },
  height: 60,
}
```

The painter works like `<canvas>`: the origin is the top left, and
units are points. It offers paths, SVG path data, rectangles, rounded
rectangles, circles, polygons, fill and stroke, gradients, opacity,
dashes, clipping, transforms, wrapped `text()`, images and `link()`.

### Table of contents and bookmarks

Headings become PDF bookmarks automatically. `{ toc: true }` adds a
table of contents with page numbers and dotted leaders. Its entries are
clickable. Use `{ h2: 'x', toc: false }` to leave a heading out, or
`outline: false` on the document to turn bookmarks off.

## Pages

```js
createPdf({
  size: 'A4',                 // A0–A6, B4, B5, Letter, Legal, Tabloid, or [w, h] like ['210mm', '99mm']
  orientation: 'portrait',
  margins: [56, 48],          // points, or '2cm', '0.75in', '20mm'
  header: (page) => (page.page > 1 ? { text: 'Acme Report', align: 'right' } : null),
  footer: { text: 'Page {page} of {pages}', align: 'center' },
  pageNumbers: true,          // shortcut for the footer above
  background: '#fffdf7',      // or content / a function of the page
  watermark: 'DRAFT',         // or { text, color, opacity, angle, size }
})
```

Headers and footers can be strings, content, or functions of
`{ page, pages, width, height, first, last }`. In strings, `{page}` and
`{pages}` become the page number and the page count.

## Fonts

There are three built-in families: Helvetica, Times and Courier. They
need no files, but they only cover Western European text. To use other
characters, embed TrueType or OpenType fonts:

```js
createPdf({
  fonts: {
    Inter: { normal: './fonts/Inter-Regular.ttf', bold: './fonts/Inter-Bold.ttf', italic: …, bolditalic: … },
    NotoSansJP: './fonts/NotoSansJP-Regular.ttf',
  },
  fallbackFonts: ['NotoSansJP'], // for characters Inter doesn't have
  defaultStyle: { font: 'Inter' },
  content: ['Hello, 世界'],
})
```

- **Subsetting:** TrueType fonts are reduced to the glyphs you use, so a
  4 MB CJK font adds only a few kilobytes.
- **Faux bold:** a family without a bold file gets a synthesized bold.
- **Not supported:** WOFF, and variable CFF2 fonts. Use the `.ttf`.

## Styles

```js
createPdf({
  defaultStyle: { font: 'Times', size: 11, lineHeight: 1.5 },
  styles: {
    h1: { color: '#1e3a8a' },             // override a built-in style
    total: { bold: true, size: 14, align: 'right' },
  },
  content: [{ text: 'Total: $120', style: 'total' }],
})
```

Built-in styles: `h1`–`h6`, `small`, `muted`, `lead`, `code`, `link`,
`caption`, `tableHeader` and `tableFooter`.

## Document info

`title`, `author`, `subject`, `keywords` and `lang` set the PDF
metadata; viewers show the title in their title bar.
`locale`/`currency`/`timeZone` drive table formats; `basePath` resolves
relative file paths; `compress: false` leaves streams readable for
debugging.

## Limits

- **Complex scripts:** Arabic, Hebrew and Indic text needs shaping and
  right-to-left layout, which this package doesn't do yet. Latin, Greek,
  Cyrillic and CJK work.
- **Kerning:** the built-in fonts and TrueType fonts with a classic kern
  table are kerned. Ligatures are not applied.
- **CFF fonts:** OpenType fonts with CFF outlines (.otf) are embedded
  whole, not subset.
- **Generation only:** this package writes PDFs. It doesn't read, merge,
  fill forms in, or encrypt existing ones.
