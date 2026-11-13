import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbook, readWorkbook, toXlsx, fromXlsx, parseCsv, toCsv, columnName, columnIndex, parseRef, dateToSerial, serialToDate, formatCode } from '../src/index.js'
import { readZip, writeZip, crc32 } from '../src/zip.js'
import { isDateFormat } from '../src/styles.js'

const text = async (bytes, name) => readZip(bytes).get(name).text()

test('zip round trip', async () => {
  const zip = await writeZip([{ name: 'a.txt', data: 'hello '.repeat(100) }, { name: 'dir/ü.txt', data: 'x' }])
  const entries = readZip(zip)
  assert.equal(await entries.get('a.txt').text(), 'hello '.repeat(100))
  assert.equal(await entries.get('dir/ü.txt').text(), 'x')
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('references and dates', () => {
  assert.equal(columnName(0), 'A')
  assert.equal(columnName(27), 'AB')
  assert.equal(columnName(16383), 'XFD')
  assert.equal(columnIndex('AB'), 27)
  assert.deepEqual(parseRef('$C$10'), { row: 9, col: 2 })
  assert.equal(dateToSerial(new Date(Date.UTC(2026, 0, 1))), 46023)
  assert.equal(serialToDate(46023.5).toISOString(), '2026-01-01T12:00:00.000Z')
  assert.equal(formatCode('currency', { currency: 'EUR' }), '"€"#,##0.00;-"€"#,##0.00')
  assert.ok(isDateFormat(14))
  assert.ok(isDateFormat(170, 'dd/mm/yyyy hh:mm'))
  assert.ok(!isDateFormat(170, '#,##0.00'))
  assert.ok(!isDateFormat(170, '"Day" 0'))
})

test('objects in, objects out', async () => {
  const rows = [
    { name: 'Ada', joined: new Date(Date.UTC(2026, 2, 1)), score: 9.5, active: true },
    { name: 'Grace', joined: new Date(Date.UTC(2026, 3, 2, 10, 30)), score: 7, active: false },
  ]
  const buf = await toXlsx(rows, { sheet: 'People' })
  const back = await fromXlsx(buf)
  assert.deepEqual(back, [
    { Name: 'Ada', Joined: rows[0].joined, Score: 9.5, Active: true },
    { Name: 'Grace', Joined: rows[1].joined, Score: 7, Active: false },
  ])
})

test('a styled workbook has every part Excel needs', async () => {
  const wb = createWorkbook({ title: 'Report', currency: 'EUR' })
  const s = wb.addSheet('Orders', {
    columns: [
      { header: 'ID', key: 'id' },
      { header: 'Total', key: 'total', format: 'currency', total: 'sum' },
    ],
    rows: [{ id: 1, total: 10 }, { id: 2, total: 20.5 }],
    print: { orientation: 'landscape', repeatHeader: true },
  })
  s.validate('A2:A3', { list: ['1', '2'] })
  s.conditionalFormat('B2:B3', { operator: '>', value: 15, style: { fill: '#fee2e2' } })
  s.merge('D1:E1', 'Merged', { bold: true })
  s.link('D3', 'https://tylix.dev', 'Docs')
  wb.addSheet('Table', { columns: ['a', 'a'], rows: [[1, 2]], table: true })
  const bytes = await wb.toBuffer()
  const zip = readZip(bytes)
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/tables/table1.xml', 'docProps/core.xml']) {
    assert.ok(zip.has(part), part)
  }
  const sheet = await text(bytes, 'xl/worksheets/sheet1.xml')
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/)
  assert.match(sheet, /<autoFilter ref="A1:B3"\/>/)
  assert.match(sheet, /<f>SUM\(B2:B3\)<\/f>/)
  assert.match(sheet, /<mergeCell ref="D1:E1"\/>/)
  assert.match(sheet, /<dataValidation type="list"/)
  assert.match(sheet, /operator="greaterThan"/)
  assert.match(sheet, /<hyperlink ref="D3" r:id="rId1"\/>/)
  assert.match(sheet, /orientation="landscape"/)
  // Element order Excel requires.
  const order = ['<sheetViews', '<cols', '<sheetData', '<autoFilter', '<mergeCells', '<conditionalFormatting', '<dataValidations', '<hyperlinks', '<pageMargins', '<pageSetup']
  const positions = order.map((t) => sheet.indexOf(t))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  const styles = await text(bytes, 'xl/styles.xml')
  assert.match(styles, /formatCode="&quot;€&quot;#,##0.00/)
  const table = await text(bytes, 'xl/tables/table1.xml')
  assert.match(table, /<tableColumn id="1" name="a"\/><tableColumn id="2" name="a2"\/>/)
  const wbXml = await text(bytes, 'xl/workbook.xml')
  assert.match(wbXml, /_xlnm.Print_Titles/)
})

test('reading back cells, formulas, merges and rich text', async () => {
  const wb = createWorkbook()
  const s = wb.addSheet('S')
  s.set('A1', 'Text')
  s.set('B1', { formula: 'SUM(1,2)', result: 3 })
  s.set('C1', { richText: [{ text: 'a', bold: true }, { text: 'b' }] })
  s.set('D1', '  spaced  ')
  s.set('E1', 'x & <y>')
  s.merge('A2:C2', 'merged')
  const back = (await readWorkbook(await wb.toBuffer())).sheet('S')
  assert.equal(back.get('A1'), 'Text')
  assert.deepEqual(back.get('B1'), { formula: 'SUM(1,2)', result: 3 })
  assert.equal(back.get('C1'), 'ab')
  assert.equal(back.get('D1'), '  spaced  ')
  assert.equal(back.get('E1'), 'x & <y>')
  assert.deepEqual(back.merges, ['A2:C2'])
  assert.deepEqual(back.toArrays()[0], ['Text', 3, 'ab', '  spaced  ', 'x & <y>'])
})

test('sheet names are validated', () => {
  const wb = createWorkbook()
  assert.throws(() => wb.addSheet('a/b'), /character/)
  assert.throws(() => wb.addSheet('x'.repeat(32)), /31/)
  wb.addSheet('Data')
  assert.throws(() => wb.addSheet('data'), /already exists/)
})

test('csv parsing', () => {
  const csv = 'name;note;n\r\nAda;"Hello; ""world""";1\nGrace;"multi\nline";2.5\n'
  assert.deepEqual(parseCsv(csv, { types: true }), [
    { name: 'Ada', note: 'Hello; "world"', n: 1 },
    { name: 'Grace', note: 'multi\nline', n: 2.5 },
  ])
  assert.deepEqual(parseCsv('a,b\n1,2', { header: false }), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('﻿x\n007', { types: true }), [{ x: '007' }])
})

test('csv writing escapes and blocks formula injection', () => {
  const out = toCsv([{ a: 'x,y', b: '=HYPERLINK("evil")', c: -5, d: 'line\nbreak' }])
  assert.equal(out, 'a,b,c,d\r\n"x,y","\'=HYPERLINK(""evil"")",-5,"line\nbreak"\r\n')
  assert.equal(toCsv([[1, 2]], { bom: true }), '﻿1,2\r\n')
})

test('csv files read as workbooks', async () => {
  const wb = await readWorkbook(new TextEncoder().encode('a,b\n1,x\n'))
  assert.deepEqual(wb.sheet(0).toObjects(), [{ a: 1, b: 'x' }])
})

test('images are embedded in a drawing', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
  const wb = createWorkbook()
  wb.addSheet('S').addImage(png, { at: 'B2', width: 20 })
  const zip = readZip(await wb.toBuffer())
  assert.ok(zip.has('xl/media/image1.png'))
  assert.ok(zip.has('xl/drawings/drawing1.xml'))
  assert.match(await zip.get('[Content_Types].xml').text(), /Extension="png"/)
})

test('send() writes to a Node-style response', async () => {
  const headers = {}
  const res = { setHeader: (k, v) => (headers[k] = v), end() {} }
  const wb = createWorkbook()
  wb.addSheet('S').set('A1', 1)
  await wb.send(res, 'report.xlsx')
  assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.match(headers['Content-Disposition'], /filename="report.xlsx"/)
})
