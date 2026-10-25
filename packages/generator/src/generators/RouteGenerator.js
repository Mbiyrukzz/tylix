import fs from 'node:fs/promises'
import path from 'node:path'

const ACTIONS = [
  { name: 'index', method: 'get', suffix: '' },
  { name: 'store', method: 'post', suffix: '' },
  { name: 'show', method: 'get', suffix: '/:id' },
  { name: 'update', method: 'put', suffix: '/:id' },
  { name: 'destroy', method: 'delete', suffix: '/:id' },
]

export class RouteGenerator {
  // Returns the written path, or null when the file already exists
  // (never overwrites hand-edited routes).
  async generate(blueprint, baseDir, language) {
    const isTs = language === 'typescript'
    const ext = isTs ? 'ts' : 'js'
    const name = blueprint.name
    const table = blueprint.tableName
    const base = `/api/${table}`

    const featureAuth = blueprint.options.auth !== false
    const publicActions = blueprint.options.publicActions ?? []
    const needsAuth = (action) => featureAuth && !publicActions.includes(action)
    const anyAuth = ACTIONS.some((a) => needsAuth(a.name))

    const routesDir = path.join(baseDir, 'app', 'routes')
    await fs.mkdir(routesDir, { recursive: true })
    const filePath = path.join(routesDir, `${table}.${ext}`)

    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false)
    if (exists) return null

    const handlerArgs = isTs
      ? '(req: TylixRequest, res: TylixResponse)'
      : '(req, res)'

    const lines = []
    if (isTs) {
      lines.push("import type { Router, TylixRequest, TylixResponse } from '@tylix/core'")
    }
    lines.push(`import { ${name}Controller } from '../controllers/${name}Controller.js'`, '')

    if (isTs && anyAuth) {
      lines.push('type RouteContext = { auth: (handler: any) => any }', '')
    }
    const signature = isTs
      ? `router: Router${anyAuth ? ', { auth }: RouteContext' : ''}`
      : `router${anyAuth ? ', { auth }' : ''}`
    lines.push(`export async function routes(${signature}) {`)
    lines.push(`  const controller = new ${name}Controller()`, '')

    for (const a of ACTIONS) {
      const call = `${handlerArgs} => controller.${a.name}(req, res)`
      const handler = needsAuth(a.name) ? `auth(${call})` : call
      lines.push(`  router.${a.method}('${base}${a.suffix}', ${handler})`)
    }
    lines.push('}', '')

    await fs.writeFile(filePath, lines.join('\n'))
    return filePath
  }
}