import fs from 'node:fs/promises'
import path from 'node:path'

const TEMPLATE = (name) => `capability ${name}

state
  value: null

action
  // define your actions here

init
  async {
    // runs once, the first time any page resolves this capability
  }
`

export async function makeCapability(name) {
  const baseDir = process.cwd()
  const capabilitiesDir = path.join(baseDir, 'app', 'capabilities')
  await fs.mkdir(capabilitiesDir, { recursive: true })

  const filePath = path.join(capabilitiesDir, `${name}.tyx`)

  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    throw new Error(`Capability "${name}" already exists at ${filePath}`)
  }

  await fs.writeFile(filePath, TEMPLATE(name))
  console.log(`\n✔ Capability created: ${path.relative(baseDir, filePath)}\n`)
}
