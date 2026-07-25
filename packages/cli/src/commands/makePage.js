import fs from 'node:fs/promises'
import path from 'node:path'

const STARTER_TEMPLATE = (name) => `page ${name}

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count = this.count + 1
  }

template
  <div>
    <h1>${name}</h1>
    <p>Count: {{ count }}, doubled: {{ doubled }}</p>
    <button onclick="{{ increment }}">+1</button>
  </div>

style
  h1 { font-family: sans-serif; }
`

export async function makePage(name) {
  const baseDir = process.cwd()
  const pagesDir = path.join(baseDir, 'app', 'pages')
  const filePath = path.join(pagesDir, `${name}.tyx`)
  await fs.mkdir(path.dirname(filePath), { recursive: true }) // was already flat mkdir

  const pageName = path.basename(name)
  await fs.writeFile(filePath, STARTER_TEMPLATE(pageName))

  console.log(`\n✔ Page created: ${path.relative(baseDir, filePath)}\n`)
}
