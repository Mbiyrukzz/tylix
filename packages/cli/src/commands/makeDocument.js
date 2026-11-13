import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

async function writeNew(file, source) {
  try {
    await fs.access(file)
    throw new Error(`${file} already exists`)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, source)
}

// tylix make:pdf Invoice -> app/pdfs/InvoicePdf.js
export async function makePdf(name) {
  const baseDir = process.cwd()
  const isTs = (await detectLanguage(baseDir)) === 'typescript'
  const ext = isTs ? 'ts' : 'js'
  const fn = `${name.charAt(0).toLowerCase()}${name.slice(1)}Pdf`
  const file = path.join(baseDir, 'app', 'pdfs', `${name}Pdf.${ext}`)
  const param = isTs ? 'data: Record<string, any>' : 'data'
  await writeNew(
    file,
    `import { createPdf } from '@tylix/pdf'

// Usage:
//   router.get('/invoices/:id/pdf', async (req, res) => {
//     await res.download(${fn}(invoice), 'invoice.pdf')
//   })
//   mail attachment: { filename: 'invoice.pdf', content: ${fn}(invoice) }
export function ${fn}(${param}) {
  return createPdf({
    title: '${name}',
    pageNumbers: true,
    content: [
      { h1: '${name}' },
      { text: [{ text: 'Date: ', bold: true }, new Date().toLocaleDateString()], style: 'muted' },
      {
        table: {
          columns: [
            { header: 'Item', key: 'name', width: '*' },
            { header: 'Qty', key: 'quantity' },
            { header: 'Price', key: 'price', format: 'currency' },
          ],
          rows: data.items ?? [],
          zebra: true,
        },
      },
    ],
  })
}
`,
  )
  console.log(`\n✔ PDF created: ${path.relative(baseDir, file)}`)
  console.log('  Needs @tylix/pdf: npm install @tylix/pdf\n')
}

// tylix make:export Orders -> app/exports/OrdersExport.js
export async function makeExport(name) {
  const baseDir = process.cwd()
  const isTs = (await detectLanguage(baseDir)) === 'typescript'
  const ext = isTs ? 'ts' : 'js'
  const fn = `${name.charAt(0).toLowerCase()}${name.slice(1)}Export`
  const file = path.join(baseDir, 'app', 'exports', `${name}Export.${ext}`)
  const param = isTs ? 'rows: Record<string, any>[]' : 'rows'
  await writeNew(
    file,
    `import { createWorkbook } from '@tylix/excel'

// Usage:
//   router.get('/${name.toLowerCase()}/export', async (req, res) => {
//     await res.download(${fn}(rows), '${name.toLowerCase()}.xlsx')
//   })
export function ${fn}(${param}) {
  const workbook = createWorkbook({ title: '${name}' })
  workbook.addSheet('${name}', {
    columns: [
      { header: 'ID', key: 'id' },
      { header: 'Name', key: 'name' },
      { header: 'Created', key: 'createdAt', format: 'date' },
    ],
    rows,
  })
  return workbook
}
`,
  )
  console.log(`\n✔ Export created: ${path.relative(baseDir, file)}`)
  console.log('  Needs @tylix/excel: npm install @tylix/excel\n')
}
