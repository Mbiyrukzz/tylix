// Workbook -> .xlsx bytes (Office Open XML SpreadsheetML).

import { writeZip } from './zip.js'
import { escapeXml, cellRef, columnName, parseRange, rangeRef, dateToSerial } from './refs.js'
import { StyleRegistry, argb, formatCode } from './styles.js'
import { loadSource } from './source.js'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const OPERATORS = {
  '>': 'greaterThan', '>=': 'greaterThanOrEqual', '<': 'lessThan', '<=': 'lessThanOrEqual', '=': 'equal', '==': 'equal',
  '!=': 'notEqual', '<>': 'notEqual', between: 'between', notBetween: 'notBetween',
}

export async function writeXlsx(workbook) {
  const opts = workbook.options
  const styles = new StyleRegistry({ currency: opts.currency, font: opts.font, size: opts.fontSize })
  const strings = new Map()
  const stringList = []
  const sharedString = (text) => {
    let i = strings.get(text)
    if (i === undefined) {
      i = stringList.length
      strings.set(text, i)
      stringList.push(text)
    }
    return i
  }

  const files = []
  const contentTypes = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ]
  const imageExts = new Set()
  let tableCount = 0
  let drawingCount = 0
  let imageCount = 0
  const definedNames = [...(workbook.names ?? [])]
  const usedTableNames = new Set()
  const sheets = workbook.sheets

  if (!sheets.length) throw new Error('A workbook needs at least one sheet')

  for (const [si, sheet] of sheets.entries()) {
    const n = si + 1
    const rels = []
    const relId = (type, target, external) => {
      const id = `rId${rels.length + 1}`
      rels.push(`<Relationship Id="${id}" Type="${REL}/${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`)
      return id
    }

    // Table header cells must hold unique column names; settle them
    // before the cells are written.
    const tableHeaders = sheet.tables.map((t) => {
      const { start, end } = parseRange(t.range)
      const headers = []
      const seen = new Set()
      for (let c = start.col; c <= end.col; c++) {
        const base = String(plainValue(sheet.rows.get(start.row)?.get(c)?.value) ?? '').replace(/[\r\n]+/g, ' ').trim() || `Column${c - start.col + 1}`
        let unique = base
        for (let k = 2; seen.has(unique.toLowerCase()); k++) unique = `${base}${k}`
        seen.add(unique.toLowerCase())
        headers.push(unique)
        const cell = sheet.cell(start.row, c)
        if (cell.value !== unique) cell.value = unique
      }
      return headers
    })

    // Column widths from content.
    const widths = new Map()
    if (sheet.autoWidth) {
      for (const [r, row] of sheet.rows) {
        for (const [c, cell] of row) {
          if (isMergedOrigin(sheet, r, c)) continue
          const w = displayWidth(cell, opts)
          if (w > (widths.get(c) ?? 0)) widths.set(c, w)
        }
      }
    }

    // Rows.
    const rowIndexes = [...new Set([...sheet.rows.keys(), ...sheet.rowProps.keys()])].sort((a, b) => a - b)
    let minRow = Infinity
    let maxRow = -1
    let minCol = Infinity
    let maxCol = -1
    let sheetData = ''
    for (const r of rowIndexes) {
      const row = sheet.rows.get(r)
      const props = sheet.rowProps.get(r) ?? {}
      let rowXml = ''
      if (row) {
        for (const c of [...row.keys()].sort((a, b) => a - b)) {
          const cell = row.get(c)
          const xml = cellXml(cell, r, c, styles, sharedString, opts, sheet)
          if (!xml) continue
          rowXml += xml
          if (r < minRow) minRow = r
          if (r > maxRow) maxRow = r
          if (c < minCol) minCol = c
          if (c > maxCol) maxCol = c
        }
      }
      let attrs = ` r="${r + 1}"`
      if (props.height) attrs += ` ht="${props.height}" customHeight="1"`
      if (props.hidden) attrs += ' hidden="1"'
      if (props.style) attrs += ` s="${styles.id(props.style)}" customFormat="1"`
      if (props.outline) attrs += ` outlineLevel="${props.outline}"`
      if (rowXml || props.height || props.hidden) sheetData += `<row${attrs}>${rowXml}</row>`
    }
    const dimension = maxRow >= 0 ? rangeRef({ row: minRow, col: minCol }, { row: maxRow, col: maxCol }) : 'A1'

    let xml = XML_HEAD + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">`
    const fitToPage = sheet.print?.fitToWidth || sheet.print?.fitToPage
    if (sheet.tabColor || fitToPage) {
      xml += '<sheetPr>'
      if (sheet.tabColor) xml += `<tabColor rgb="${argb(sheet.tabColor)}"/>`
      if (fitToPage) xml += '<pageSetUpPr fitToPage="1"/>'
      xml += '</sheetPr>'
    }
    xml += `<dimension ref="${dimension}"/>`
    xml += '<sheetViews><sheetView'
    if (si === (workbook.activeSheet ?? 0)) xml += ' tabSelected="1"'
    if (!sheet.showGridLines) xml += ' showGridLines="0"'
    if (sheet.rightToLeft) xml += ' rightToLeft="1"'
    if (sheet.zoom) xml += ` zoomScale="${sheet.zoom}"`
    xml += ' workbookViewId="0">'
    if (sheet.pane && (sheet.pane.row || sheet.pane.col)) {
      const { row, col } = sheet.pane
      const pane = row && col ? 'bottomRight' : row ? 'bottomLeft' : 'topRight'
      xml += `<pane${col ? ` xSplit="${col}"` : ''}${row ? ` ySplit="${row}"` : ''} topLeftCell="${cellRef(row, col)}" activePane="${pane}" state="frozen"/>`
      xml += `<selection pane="${pane}" activeCell="${cellRef(row, col)}" sqref="${cellRef(row, col)}"/>`
    }
    xml += '</sheetView></sheetViews>'
    xml += `<sheetFormatPr defaultRowHeight="15"${opts.defaultColumnWidth ? ` defaultColWidth="${opts.defaultColumnWidth}"` : ''}/>`

    const colIndexes = [...new Set([...sheet.colProps.keys(), ...widths.keys()])].sort((a, b) => a - b)
    if (colIndexes.length) {
      xml += '<cols>'
      for (const c of colIndexes) {
        const p = sheet.colProps.get(c) ?? {}
        const width = p.width ?? (widths.has(c) ? clampWidth(widths.get(c)) : null)
        if (width == null && !p.hidden && !p.style) continue
        xml += `<col min="${c + 1}" max="${c + 1}"`
        xml += ` width="${width ?? 9.140625}"${width != null ? ' customWidth="1"' : ''}`
        if (p.hidden) xml += ' hidden="1"'
        if (p.style) xml += ` style="${styles.id(p.style)}"`
        if (p.outline) xml += ` outlineLevel="${p.outline}"`
        xml += '/>'
      }
      xml += '</cols>'
      xml = xml.replace('<cols></cols>', '')
    }
    xml += `<sheetData>${sheetData}</sheetData>`

    // Auto filter (not with tables, which have their own).
    let filterRef = null
    if (sheet.filter || sheet.filterAuto) {
      filterRef = sheet.filter ?? (sheet.headerRow != null ? `${cellRef(sheet.headerRow, 0)}:${cellRef(Math.max(sheet.lastDataRow ?? sheet.headerRow, sheet.headerRow), Math.max(0, sheet.columns.length - 1))}` : null)
      if (filterRef) {
        xml += `<autoFilter ref="${filterRef}"/>`
        definedNames.push({ name: '_xlnm._FilterDatabase', sheet: si, ref: absolute(sheet.name, filterRef), hidden: true })
      }
    }
    if (sheet.merges.length) xml += `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`

    if (sheet.conditionals.length) {
      let priority = 1
      for (const { range, rule } of sheet.conditionals) {
        xml += `<conditionalFormatting sqref="${escapeXml(range)}">${conditionalXml(rule, range, styles, priority++)}</conditionalFormatting>`
      }
    }
    if (sheet.validations.length) {
      xml += `<dataValidations count="${sheet.validations.length}">`
      for (const { range, rule } of sheet.validations) xml += validationXml(range, rule)
      xml += '</dataValidations>'
    }
    const links = []
    for (const [r, row] of sheet.rows) for (const [c, cell] of row) if (cell.link || (cell.value && typeof cell.value === 'object' && cell.value.link)) links.push({ ref: cellRef(r, c), ...(cell.link ?? { target: cell.value.link, tooltip: cell.value.tooltip }) })
    if (links.length) {
      xml += '<hyperlinks>'
      for (const l of links) {
        const target = String(l.target)
        const tip = l.tooltip ? ` tooltip="${escapeXml(l.tooltip)}"` : ''
        if (target.startsWith('#')) xml += `<hyperlink ref="${l.ref}" location="${escapeXml(target.slice(1))}"${tip}/>`
        else xml += `<hyperlink ref="${l.ref}" r:id="${relId('hyperlink', target, true)}"${tip}/>`
      }
      xml += '</hyperlinks>'
    }

    const print = sheet.print
    if (print) {
      if (print.gridLines || print.center) xml += `<printOptions${print.gridLines ? ' gridLines="1"' : ''}${print.center ? ' horizontalCentered="1"' : ''}/>`
      const m = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3, ...(print.margins ?? {}) }
      xml += `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`
      const paper = { letter: 1, legal: 5, a3: 8, a4: 9, a5: 11 }[String(print.paper ?? '').toLowerCase()]
      xml += '<pageSetup'
      if (paper) xml += ` paperSize="${paper}"`
      if (print.orientation) xml += ` orientation="${print.orientation}"`
      if (fitToPage) xml += ` fitToWidth="1" fitToHeight="${print.fitToPage ? 1 : 0}"`
      xml += '/>'
      if (print.header || print.footer) {
        xml += '<headerFooter>'
        if (print.header) xml += `<oddHeader>${escapeXml(headerFooterText(print.header))}</oddHeader>`
        if (print.footer) xml += `<oddFooter>${escapeXml(headerFooterText(print.footer))}</oddFooter>`
        xml += '</headerFooter>'
      }
      if (print.repeatHeader && sheet.headerRow != null) {
        definedNames.push({ name: '_xlnm.Print_Titles', sheet: si, ref: `'${sheet.name.replace(/'/g, "''")}'!$${sheet.headerRow + 1}:$${sheet.headerRow + 1}` })
      }
    } else {
      xml += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    }

    // Images: one drawing part per sheet.
    if (sheet.images.length) {
      drawingCount++
      const drawingRels = []
      let anchors = ''
      for (const [k, img] of sheet.images.entries()) {
        const bytes = await loadSource(img.source, opts.basePath)
        const info = imageInfo(bytes)
        imageCount++
        imageExts.add(info.ext)
        const mediaName = `image${imageCount}.${info.ext}`
        files.push({ name: `xl/media/${mediaName}`, data: bytes })
        const rid = `rId${k + 1}`
        drawingRels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="../media/${mediaName}"/>`)
        let w = img.width
        let h = img.height
        if (w && !h) h = Math.round((w * info.height) / info.width)
        else if (h && !w) w = Math.round((h * info.width) / info.height)
        else if (!w && !h) {
          w = info.width
          h = info.height
        }
        const emu = 9525
        anchors +=
          `<xdr:oneCellAnchor><xdr:from><xdr:col>${img.at.col}</xdr:col><xdr:colOff>${img.offsetX * emu}</xdr:colOff><xdr:row>${img.at.row}</xdr:row><xdr:rowOff>${img.offsetY * emu}</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${w * emu}" cy="${h * emu}"/>` +
          `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Picture ${k + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w * emu}" cy="${h * emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
      }
      files.push({
        name: `xl/drawings/drawing${drawingCount}.xml`,
        data: XML_HEAD + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}">${anchors}</xdr:wsDr>`,
      })
      files.push({ name: `xl/drawings/_rels/drawing${drawingCount}.xml.rels`, data: relsXml(drawingRels) })
      contentTypes.push(`<Override PartName="/xl/drawings/drawing${drawingCount}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)
      xml += `<drawing r:id="${relId('drawing', `../drawings/drawing${drawingCount}.xml`)}"/>`
    }

    if (sheet.tables.length) {
      const parts = []
      for (const [ti, t] of sheet.tables.entries()) {
        tableCount++
        const { start, end } = parseRange(t.range)
        const headers = tableHeaders[ti]
        let name = (t.name ?? `${sheet.name}Table`).replace(/[^A-Za-z0-9_.]/g, '_')
        if (!/^[A-Za-z_]/.test(name)) name = 'T_' + name
        let unique = name
        for (let k = 2; usedTableNames.has(unique.toLowerCase()); k++) unique = `${name}${k}`
        usedTableNames.add(unique.toLowerCase())
        const ref = rangeRef(start, end)
        files.push({
          name: `xl/tables/table${tableCount}.xml`,
          data:
            XML_HEAD +
            `<table xmlns="${NS}" id="${tableCount}" name="${unique}" displayName="${unique}" ref="${ref}" totalsRowShown="0">` +
            `<autoFilter ref="${ref}"/>` +
            `<tableColumns count="${headers.length}">${headers.map((h, i) => `<tableColumn id="${i + 1}" name="${escapeXml(h)}"/>`).join('')}</tableColumns>` +
            `<tableStyleInfo name="${escapeXml(t.style)}" showFirstColumn="0" showLastColumn="0" showRowStripes="${t.stripes ? 1 : 0}" showColumnStripes="0"/></table>`,
        })
        contentTypes.push(`<Override PartName="/xl/tables/table${tableCount}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`)
        parts.push(`<tablePart r:id="${relId('table', `../tables/table${tableCount}.xml`)}"/>`)
      }
      xml += `<tableParts count="${parts.length}">${parts.join('')}</tableParts>`
    }
    xml += '</worksheet>'
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: xml })
    if (rels.length) files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: relsXml(rels) })
    contentTypes.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
  }

  for (const ext of imageExts) contentTypes.unshift(`<Default Extension="${ext}" ContentType="${{ png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' }[ext]}"/>`)

  // Workbook.
  let wbXml = XML_HEAD + `<workbook xmlns="${NS}" xmlns:r="${NS_R}">`
  wbXml += `<workbookPr${opts.date1904 ? ' date1904="1"' : ''}/>`
  wbXml += `<bookViews><workbookView activeTab="${workbook.activeSheet ?? 0}"/></bookViews><sheets>`
  sheets.forEach((s, i) => {
    wbXml += `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`
  })
  wbXml += '</sheets>'
  if (definedNames.length) {
    wbXml += '<definedNames>'
    for (const d of definedNames) {
      wbXml += `<definedName name="${escapeXml(d.name)}"${d.sheet != null ? ` localSheetId="${d.sheet}"` : ''}${d.hidden ? ' hidden="1"' : ''}>${escapeXml(d.ref)}</definedName>`
    }
    wbXml += '</definedNames>'
  }
  wbXml += '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'
  files.push({ name: 'xl/workbook.xml', data: wbXml })
  const wbRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
  wbRels.push(`<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>`)
  wbRels.push(`<Relationship Id="rId${sheets.length + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`)
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: relsXml(wbRels) })

  files.push({ name: 'xl/styles.xml', data: styles.xml() })
  files.push({
    name: 'xl/sharedStrings.xml',
    data:
      XML_HEAD +
      `<sst xmlns="${NS}" count="${stringList.length}" uniqueCount="${stringList.length}">` +
      stringList.map((s) => (typeof s === 'string' ? `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${escapeXml(s)}</t></si>` : s.xml)).join('') +
      '</sst>',
  })

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const p = workbook.properties
  files.push({
    name: 'docProps/core.xml',
    data:
      XML_HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      (p.title ? `<dc:title>${escapeXml(p.title)}</dc:title>` : '') +
      (p.subject ? `<dc:subject>${escapeXml(p.subject)}</dc:subject>` : '') +
      `<dc:creator>${escapeXml(p.creator ?? 'Tylix')}</dc:creator>` +
      (p.keywords ? `<cp:keywords>${escapeXml([].concat(p.keywords).join(', '))}</cp:keywords>` : '') +
      (p.description ? `<dc:description>${escapeXml(p.description)}</dc:description>` : '') +
      `<cp:lastModifiedBy>${escapeXml(p.creator ?? 'Tylix')}</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${p.created ? new Date(p.created).toISOString().replace(/\.\d+Z$/, 'Z') : now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>',
  })
  files.push({
    name: 'docProps/app.xml',
    data:
      XML_HEAD +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      `<Application>${escapeXml(p.application ?? 'Tylix Excel')}</Application>${p.company ? `<Company>${escapeXml(p.company)}</Company>` : ''}</Properties>`,
  })
  files.push({
    name: '_rels/.rels',
    data: relsXml([
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>`,
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>`,
    ]),
  })
  files.unshift({
    name: '[Content_Types].xml',
    data: XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes.join('')}</Types>`,
  })
  return writeZip(files, { compress: opts.compress !== false })
}

function relsXml(list) {
  return XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.join('')}</Relationships>`
}

function absolute(sheetName, ref) {
  const { start, end } = parseRange(ref)
  const quoted = `'${sheetName.replace(/'/g, "''")}'`
  return `${quoted}!$${columnName(start.col)}$${start.row + 1}:$${columnName(end.col)}$${end.row + 1}`
}

function headerFooterText(v) {
  if (typeof v === 'string') return '&C' + v.replace(/\{page\}/g, '&P').replace(/\{pages\}/g, '&N').replace(/\{sheet\}/g, '&A')
  const part = (s) => (s ? s.replace(/\{page\}/g, '&P').replace(/\{pages\}/g, '&N').replace(/\{sheet\}/g, '&A').replace(/\{date\}/g, '&D') : '')
  return (v.left ? '&L' + part(v.left) : '') + (v.center ? '&C' + part(v.center) : '') + (v.right ? '&R' + part(v.right) : '')
}

function plainValue(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) return v.text ?? v.result ?? null
  return v
}

function isMergedOrigin(sheet, r, c) {
  // Merged cells shouldn't widen their first column.
  for (const m of sheet.merges) {
    const { start, end } = parseRange(m)
    if (start.row === r && start.col === c && end.col > start.col) return true
  }
  return false
}

function clampWidth(chars) {
  return Math.round(Math.min(80, Math.max(6, chars * 1.1 + 2)) * 100) / 100
}

// Approximate characters a value needs.
function displayWidth(cell, opts) {
  const v = cell.value
  if (v == null) return 0
  const bold = cell.style?.bold ? 1.1 : 1
  const size = (cell.style?.size ?? 11) / 11
  let text
  if (v instanceof Date) text = 'yyyy-mm-dd' + (v.getUTCHours() || v.getUTCMinutes() ? ' hh:mm' : '')
  else if (typeof v === 'number') {
    // Estimated from digit counts (toLocaleString is far too slow for
    // every cell of a big sheet).
    const fmt = cell.style?.format
    const digits = Math.max(1, Math.floor(Math.log10(Math.abs(v) || 1)) + 1)
    const grouped = digits + Math.floor((digits - 1) / 3)
    const sign = v < 0 ? 1 : 0
    if (fmt === 'currency' || fmt === 'accounting') return (grouped + 3 + 3 + sign) * bold * size
    if (fmt === 'percent' || fmt === 'percent1' || fmt === 'percent2') return (digits + 2 + 4) * bold * size
    if (fmt === 'integer') return (grouped + sign) * bold * size
    if (fmt === 'decimal' || fmt === 'number') return (grouped + 3 + sign) * bold * size
    if (Number.isInteger(v)) return (digits + sign) * bold * size
    return Math.min(12, String(Math.round(v * 100) / 100).length) * bold * size
  } else if (typeof v === 'object') {
    if (v.formula) return 10
    text = v.text ?? (v.richText ? v.richText.map((r) => r.text).join('') : '')
  } else text = String(v)
  if (cell.style?.wrap) return Math.min(40, longestLine(text)) * bold * size
  return longestLine(text) * bold * size + (cell.style?.bold && cell.style?.fill ? 2 : 0)
}

function longestLine(text) {
  let max = 0
  for (const line of String(text).split('\n')) {
    // Wide characters (CJK) take about two columns.
    let w = 0
    for (const ch of line) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
    if (w > max) max = w
  }
  return max
}

function cellXml(cell, r, c, styles, sharedString, opts, sheet) {
  let v = cell.value
  let style = cell.style ? { ...cell.style } : null
  const ref = cellRef(r, c)
  if (v && typeof v === 'object' && !(v instanceof Date) && v.link && !v.formula) {
    // { text, link }: blue underlined text unless styled otherwise.
    style = { color: '#0563C1', underline: true, ...(style ?? {}) }
    v = v.text ?? v.link
  } else if (cell.link) style = { color: '#0563C1', underline: true, ...(style ?? {}) }

  if (v instanceof Date) {
    if (isNaN(v)) v = null
    else {
      if (!style?.format) {
        const hasTime = opts.dateMode === 'local' ? v.getHours() || v.getMinutes() || v.getSeconds() : v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds()
        style = { ...(style ?? {}), format: hasTime ? 'datetime' : 'date' }
      }
      v = dateToSerial(v, { date1904: opts.date1904, local: opts.dateMode === 'local' })
    }
  }
  const s = style ? styles.id(style) : 0
  const sAttr = s ? ` s="${s}"` : ''
  if (v == null || v === '') return s ? `<c r="${ref}"${sAttr}/>` : ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return `<c r="${ref}"${sAttr} t="e"><v>#NUM!</v></c>`
    return `<c r="${ref}"${sAttr}><v>${v}</v></c>`
  }
  if (typeof v === 'bigint') return `<c r="${ref}"${sAttr}><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`
  if (typeof v === 'object') {
    if (v.formula != null) {
      const f = escapeXml(String(v.formula).replace(/^=/, ''))
      const result = v.result
      if (result == null) return `<c r="${ref}"${sAttr}><f>${f}</f></c>`
      if (typeof result === 'number') return `<c r="${ref}"${sAttr}><f>${f}</f><v>${result}</v></c>`
      if (typeof result === 'boolean') return `<c r="${ref}"${sAttr} t="b"><f>${f}</f><v>${result ? 1 : 0}</v></c>`
      return `<c r="${ref}"${sAttr} t="str"><f>${f}</f><v>${escapeXml(result)}</v></c>`
    }
    if (v.richText) {
      const runs = v.richText
        .map((run) => {
          // Element order matters to Excel (CT_RPrElt).
          let rPr = ''
          if (run.font) rPr += `<rFont val="${escapeXml(run.font)}"/>`
          if (run.bold) rPr += '<b/>'
          if (run.italic) rPr += '<i/>'
          if (run.strike) rPr += '<strike/>'
          if (run.color) rPr += `<color rgb="${argb(run.color)}"/>`
          if (run.size) rPr += `<sz val="${run.size}"/>`
          if (run.underline) rPr += '<u/>'
          return `<r>${rPr ? `<rPr>${rPr}</rPr>` : ''}<t xml:space="preserve">${escapeXml(run.text)}</t></r>`
        })
        .join('')
      const idx = sharedString({ xml: `<si>${runs}</si>`, toString: () => runs })
      return `<c r="${ref}"${sAttr} t="s"><v>${idx}</v></c>`
    }
    if (v.error) return `<c r="${ref}"${sAttr} t="e"><v>${escapeXml(v.error)}</v></c>`
    if (v.text != null) v = String(v.text)
    else v = JSON.stringify(v)
  }
  const text = String(v)
  if (text.length > 32767) throw new Error(`Cell ${sheet.name}!${ref} has more than 32,767 characters (Excel's limit)`)
  return `<c r="${ref}"${sAttr} t="s"><v>${sharedString(text)}</v></c>`
}

function cfValue(v) {
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return String(dateToSerial(v))
  if (typeof v === 'string' && /^=/.test(v)) return escapeXml(v.slice(1))
  return `"${escapeXml(String(v).replace(/"/g, '""'))}"`
}

function conditionalXml(rule, range, styles, priority) {
  const type = rule.type ?? (rule.operator ? 'cellIs' : rule.formula ? 'expression' : null)
  const dxf = () => styles.dxf(rule.style ?? { fill: '#FEE2E2', color: '#991B1B' })
  switch (type) {
    case 'cellIs': {
      const op = OPERATORS[rule.operator] ?? rule.operator
      const values = Array.isArray(rule.value) ? rule.value : [rule.value]
      return `<cfRule type="cellIs" dxfId="${dxf()}" priority="${priority}" operator="${op}">${values.map((v) => `<formula>${cfValue(v)}</formula>`).join('')}</cfRule>`
    }
    case 'expression':
      return `<cfRule type="expression" dxfId="${dxf()}" priority="${priority}"><formula>${escapeXml(String(rule.formula).replace(/^=/, ''))}</formula></cfRule>`
    case 'contains': {
      const first = range.split(/[:\s]/)[0]
      const text = String(rule.text).replace(/"/g, '""')
      return `<cfRule type="containsText" dxfId="${dxf()}" priority="${priority}" operator="containsText" text="${escapeXml(rule.text)}"><formula>NOT(ISERROR(SEARCH("${escapeXml(text)}",${first})))</formula></cfRule>`
    }
    case 'duplicate':
    case 'unique':
      return `<cfRule type="${type === 'duplicate' ? 'duplicateValues' : 'uniqueValues'}" dxfId="${dxf()}" priority="${priority}"/>`
    case 'top':
    case 'bottom':
      return `<cfRule type="top10" dxfId="${dxf()}" priority="${priority}" rank="${rule.rank ?? 10}"${type === 'bottom' ? ' bottom="1"' : ''}${rule.percent ? ' percent="1"' : ''}/>`
    case 'dataBar':
      return `<cfRule type="dataBar" priority="${priority}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(rule.color ?? '#638EC6')}"/></dataBar></cfRule>`
    case 'colorScale': {
      const colors = rule.colors ?? ['#F8696B', '#FFEB84', '#63BE7B']
      const cfvos = colors.length === 3 ? '<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>' : '<cfvo type="min"/><cfvo type="max"/>'
      return `<cfRule type="colorScale" priority="${priority}"><colorScale>${cfvos}${colors.map((c) => `<color rgb="${argb(c)}"/>`).join('')}</colorScale></cfRule>`
    }
  }
  throw new Error(`Unknown conditional format type "${rule.type}" (cellIs, expression, contains, duplicate, unique, top, bottom, dataBar, colorScale)`)
}

function validationXml(range, rule) {
  let type = rule.type
  let f1 = null
  let f2 = null
  let operator = null
  if (rule.list) {
    type = 'list'
    f1 = Array.isArray(rule.list) ? `"${rule.list.map((v) => String(v).replace(/"/g, '""')).join(',')}"` : String(rule.list).replace(/^=/, '')
    if (Array.isArray(rule.list) && f1.length > 257) throw new Error('A dropdown list is limited to 255 characters; put the options in cells and pass a range like "Lists!A1:A50"')
  } else if (rule.formula) {
    type = 'custom'
    f1 = String(rule.formula).replace(/^=/, '')
  } else {
    type = type ?? 'decimal'
    const val = (v) => (v instanceof Date ? String(dateToSerial(v)) : String(v))
    if (rule.between) {
      operator = 'between'
      f1 = val(rule.between[0])
      f2 = val(rule.between[1])
    } else if (rule.min != null && rule.max != null) {
      operator = 'between'
      f1 = val(rule.min)
      f2 = val(rule.max)
    } else if (rule.min != null) {
      operator = 'greaterThanOrEqual'
      f1 = val(rule.min)
    } else if (rule.max != null) {
      operator = 'lessThanOrEqual'
      f1 = val(rule.max)
    }
  }
  let xml = `<dataValidation type="${type}"${operator ? ` operator="${operator}"` : ''} allowBlank="${rule.allowBlank === false ? 0 : 1}" showInputMessage="1" showErrorMessage="${rule.strict === false ? 0 : 1}"`
  if (rule.error) xml += ` errorTitle="${escapeXml(rule.errorTitle ?? 'Invalid value')}" error="${escapeXml(rule.error)}"`
  if (rule.prompt) xml += ` promptTitle="${escapeXml(rule.promptTitle ?? '')}" prompt="${escapeXml(rule.prompt)}"`
  xml += ` sqref="${escapeXml(range)}">`
  if (f1 != null) xml += `<formula1>${escapeXml(f1)}</formula1>`
  if (f2 != null) xml += `<formula2>${escapeXml(f2)}</formula2>`
  return xml + '</dataValidation>'
}

function imageInfo(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset)
    return { ext: 'png', width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return { ext: 'gif', width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2
    while (p < bytes.length) {
      if (bytes[p] !== 0xff) {
        p++
        continue
      }
      const m = bytes[p + 1]
      const len = (bytes[p + 2] << 8) | bytes[p + 3]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { ext: 'jpeg', height: (bytes[p + 5] << 8) | bytes[p + 6], width: (bytes[p + 7] << 8) | bytes[p + 8] }
      }
      p += 2 + len
    }
  }
  throw new Error('Images must be PNG, JPEG or GIF')
}

export { formatCode }
