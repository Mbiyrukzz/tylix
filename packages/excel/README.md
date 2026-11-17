<p align="center">
  <img src="https://raw.githubusercontent.com/Mbiyrukzz/tylix/main/packages/excel/logo.png" alt="Tylix Excel" width="360">
</p>

# @tylix/excel

Excel files from your data, and your data from Excel files. Write a
styled `.xlsx` from an array of objects in one line, or build reports
with formats, formulas, totals, tables, dropdowns, conditional
formatting and images. Read workbooks and CSV back into plain objects.
It runs in Node, Deno, Bun, edge runtimes and the browser, with no
dependencies.

```sh
npm install @tylix/excel
```

```js
import { toXlsx, fromXlsx } from '@tylix/excel'

const buffer = await toXlsx(users)       // a header row from the keys, sized columns, filters
const rows = await fromXlsx('./import.xlsx') // [{ Name: 'Ada', Email: '…', Joined: Date }, …]
```

## Why use it

- **One line each way.** `toXlsx(rows)` and `fromXlsx(file)` cover most
  imports and exports.
- **Polished by default.** Headers are bold and shaded. The header row is
  frozen with filter buttons, columns fit their content, numeric headers
  line up with their numbers, and dates are real Excel dates.
- **Named formats.** Write `format: 'currency'`, `'percent'` or `'date'`
  instead of format codes. Excel format codes still work.
- **Real reports.** Totals rows, formulas, Excel tables, dropdown lists,
  conditional formatting (data bars, color scales, highlight rules),
  merged cells, hyperlinks, images, print setup and multiple sheets.
- **Safe CSV.** `toCsv` neutralizes formula injection by default. CSV
  parsing handles quotes, embedded newlines, byte-order marks and
  semicolon-separated files from European Excel.
- **Fast enough for big exports.** It writes 100,000 rows × 6 columns in
  about 2.5 s and reads them back in under 2 s on a laptop.

## Writing a report

```js
import { createWorkbook } from '@tylix/excel'

const workbook = createWorkbook({ title: 'Q3 orders', creator: 'Acme', currency: 'EUR' })

const sheet = workbook.addSheet('Orders', {
  columns: [
    { header: 'Order', key: 'id' },
    { header: 'Customer', key: 'customer.name' },  // nested keys work
    { header: 'Date', key: 'createdAt', format: 'date' },
    { header: 'Status', key: 'status' },
    { header: 'Total', key: 'total', format: 'currency', total: 'sum' },
    { header: 'Margin', key: 'margin', format: 'percent', total: 'average' },
  ],
  rows: orders,
  tabColor: '#2563eb',
})

sheet.validate('D2:D500', { list: ['Paid', 'Pending', 'Refunded'] })
sheet.conditionalFormat('E2:E500', { type: 'dataBar', color: '#60a5fa' })
sheet.conditionalFormat('D2:D500', { operator: '=', value: 'Pending', style: { fill: '#fef3c7', color: '#92400e' } })
sheet.print = { orientation: 'landscape', fitToWidth: true, repeatHeader: true, footer: 'Page {page} of {pages}' }

await workbook.save('orders.xlsx')
```

With `columns`, each row is an object read by `key`, or an array read by
position. A sheet with columns gets:

- a styled header row, frozen, with filter buttons;
- column widths fitted to the content;
- a totals row when any column has `total`: `'sum'`, `'average'`,
  `'count'`, `'min'`, `'max'`, a label, or `{ formula }`.

Options:

- `freeze: false` and `autoFilter: false` turn the frozen header and the
  filters off.
- `table: true` makes the data an Excel table, with banded rows and
  structured references (`{ style: 'TableStyleLight9' }` to pick a style).
- `headerStyle` restyles the header row.
- `autoWidth: false` keeps the default column widths.

## Cells

```js
sheet.set('A1', 'Hello', { bold: true, size: 14 })
sheet.set('B1', 1250.5, { format: 'currency' })
sheet.set('C1', new Date())                            // gets a date format
sheet.set('D1', { formula: 'SUM(B1:B10)' })
sheet.set('E1', { text: 'Docs', link: 'https://tylix.dev' })
sheet.set('F1', { richText: [{ text: 'Bold ', bold: true }, { text: 'red', color: '#dc2626' }] })
sheet.cell('G1').value = true
sheet.cell(4, 2).style = { fill: '#fee2e2' }           // zero-based row, col
sheet.addRow({ id: 1, name: 'Ada' })                    // by column key
sheet.addRow([1, 'Ada', new Date()])                    // by position
sheet.merge('A1:D1', 'Quarterly report', { bold: true, align: 'center' })
sheet.style('A2:D2', { border: true })
sheet.column('B').width = 30
sheet.row(1).height = 28
sheet.freeze('B2')                                      // rows above and columns left of B2
sheet.link('A10', '#Summary!A1', 'Back to summary')     // a link inside the workbook
sheet.addImage('./logo.png', { at: 'H2', width: 120 })   // PNG, JPEG or GIF
```

Styles are plain objects:

| Property | Values |
| --- | --- |
| `bold`, `italic`, `strike` | `true` |
| `underline` | `true`, `'double'` |
| `font`, `size`, `color` | `'Arial'`, `12`, `'#1f2937'` |
| `fill` | `'#f3f4f6'` (background) |
| `align`, `valign` | `'left' \| 'center' \| 'right'`, `'top' \| 'middle' \| 'bottom'` |
| `wrap`, `indent`, `rotate`, `shrink` | `true`, `2`, `45`, `true` |
| `border` | `true`, `'medium'`, or `{ top, right, bottom, left, color, style }` |
| `format` | `general`, `integer`, `number`, `decimal`, `currency`, `accounting`, `percent`, `percent1`, `percent2`, `date`, `datetime`, `time`, `text`, `scientific`, or any Excel format code |

Identical styles share one entry in the file, so styling every cell
doesn't make it bigger.

The `currency` format uses the workbook's `currency` (USD, EUR, GBP,
KES, NGN, ZAR, INR, JPY and more). Dates are written in UTC; set
`dateMode: 'local'` to keep local wall-clock times.

## Validation and conditional formatting

```js
sheet.validate('C2:C100', { list: ['Low', 'Medium', 'High'] })
sheet.validate('D2:D100', { list: 'Lists!A1:A20' })                  // options from cells
sheet.validate('E2:E100', { type: 'whole', min: 0, max: 100, error: 'Enter 0–100' })
sheet.validate('F2:F100', { type: 'date', min: new Date('2026-01-01') })
sheet.validate('G2:G100', { formula: 'LEN(G2)<=10', prompt: 'Up to 10 characters' })

sheet.conditionalFormat('B2:B100', { operator: '>', value: 1000, style: { fill: '#dcfce7', color: '#166534', bold: true } })
sheet.conditionalFormat('B2:B100', { operator: 'between', value: [10, 20] })
sheet.conditionalFormat('A2:F100', { formula: '$D2="Overdue"', style: { fill: '#fee2e2' } }) // whole row
sheet.conditionalFormat('C2:C100', { type: 'contains', text: 'urgent' })
sheet.conditionalFormat('A2:A100', { type: 'duplicate' })
sheet.conditionalFormat('E2:E100', { type: 'top', rank: 5 })
sheet.conditionalFormat('E2:E100', { type: 'colorScale' })            // red, yellow, green
sheet.conditionalFormat('E2:E100', { type: 'dataBar', color: '#60a5fa' })
```

## Several sheets at once

```js
await toXlsx({
  Customers: customers,
  Orders: { rows: orders, columns: [{ header: 'Total', key: 'total', format: 'currency', total: 'sum' }] },
})
```

## Reading

```js
import { readWorkbook, fromXlsx } from '@tylix/excel'

const rows = await fromXlsx(file, { sheet: 'Orders' }) // objects keyed by the header row

const workbook = await readWorkbook(file)            // path, URL, bytes, Blob, .xlsx or .csv
const sheet = workbook.sheet('Orders')
sheet.get('B2')            // a value: number, string, boolean, Date, null
sheet.cell('E10').formula  // 'SUM(E2:E9)'; .value is { formula, result }
sheet.toArrays()           // rows as arrays
sheet.toObjects({ headerRow: 2 })
sheet.merges               // ['A1:D1']
```

Values come back with their types:

- Numbers in date formats become `Date` objects. `raw: true` keeps the
  serial numbers.
- Shared, inline and rich text become strings.
- Errors become `{ error: '#N/A' }`.
- Formulas give the result Excel last saved.

You can edit a workbook you've read and save it again. Values, merges,
column widths, row heights and frozen panes are kept; cell styles are
not.

## CSV

```js
import { parseCsv, toCsv } from '@tylix/excel'

parseCsv(text)                      // objects keyed by the first line; detects , ; tab |
parseCsv(text, { types: true })     // numbers, booleans and null instead of strings
parseCsv(text, { header: false })   // arrays
toCsv(rows)                         // RFC 4180; =, +, -, @ at the start get a ' prefix
toCsv(rows, { columns: ['name', { key: 'total', header: 'Total', format: (v) => v.toFixed(2) }], bom: true, delimiter: ';' })
workbook.toCsv({ sheet: 'Orders' })
```

`bom: true` adds a byte-order mark, so Excel opens UTF-8 CSV files with
accents and non-Latin text correctly. `escapeFormulas: false` turns the
formula-injection protection off.

## Output

```js
await workbook.toBuffer()             // Buffer in Node, Uint8Array elsewhere
await workbook.save('report.xlsx')    // or .csv
await workbook.send(res, 'report.xlsx')
await workbook.toResponse('report.xlsx') // fetch Response
await workbook.download('report.xlsx')   // browser
await workbook.toBlob()
```

## In Tylix

```js
router.get('/orders/export', async (req, res) => {
  await res.download(ordersExport(await Order.all()), 'orders.xlsx')
})
```

`tylix make:export Orders` creates `app/exports/OrdersExport.js`. A
workbook can also be a mail attachment:
`{ filename: 'orders.xlsx', content: workbook }`. In the browser, `.tyx`
pages can import the package from `/_tylix/excel/index.js`.

## Limits

- **Formulas aren't calculated.** Excel and LibreOffice calculate them
  when the file is opened. Pass `{ formula, result }` to include a value
  for programs that don't calculate.
- **Not supported:** charts, pivot tables, comments, sheet protection and
  the old binary `.xls` format.
- **Reading keeps values, not styles.** Cell styles from the file are
  dropped.
