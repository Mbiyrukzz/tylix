import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

export async function makeMail(name) {
  const baseDir = process.cwd()
  const mailDir = path.join(baseDir, 'app', 'mail')
  const viewsDir = path.join(baseDir, 'resources', 'mail')
  await fs.mkdir(mailDir, { recursive: true })
  await fs.mkdir(viewsDir, { recursive: true })

  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'
  const isTs = language === 'typescript'

  const className = `${name}Mail`
  const viewName = name.charAt(0).toLowerCase() + name.slice(1)

  const mailablePath = path.join(mailDir, `${className}.${ext}`)
  const source = isTs
    ? `import { Mailable } from '@tylix/mail'

export class ${className} extends Mailable {
  constructor(private data: Record<string, unknown> = {}) {
    super()
  }

  build() {
    return {
      subject: '${name}',
      view: '${viewName}',
      data: this.data,
    }
  }
}
`
    : `import { Mailable } from '@tylix/mail'

export class ${className} extends Mailable {
  constructor(data = {}) {
    super()
    this.data = data
  }

  build() {
    return {
      subject: '${name}',
      view: '${viewName}',
      data: this.data,
    }
  }
}
`
  await fs.writeFile(mailablePath, source)

  const viewPath = path.join(viewsDir, `${viewName}.html`)
  const viewSource = `<h1>${name}</h1>
<p>{{ message }}</p>
`
  await fs.writeFile(viewPath, viewSource)

  console.log(`\n✔ Mailable created: ${path.relative(baseDir, mailablePath)}`)
  console.log(`  View: ${path.relative(baseDir, viewPath)}\n`)
}
