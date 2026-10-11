import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

const METHODS = ['get', 'post', 'put', 'delete']
const BODY_METHODS = ['post', 'put']
const NAME_RE = /^[a-z][a-zA-Z0-9]*$/
const PATH_RE = /^\/api(\/([a-z0-9-]+|:[A-Za-z_]\w*))+$/

function kebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export async function makeApi(name, options = {}) {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid name "${name}". Use letters and digits, starting with a lowercase letter (e.g. contact, getPost).`,
    )
  }

  const method = (options.method ?? 'post').toLowerCase()
  if (!METHODS.includes(method)) {
    throw new Error(`Unsupported method "${method}". Use: ${METHODS.join(', ')}`)
  }

  const route = options.path ?? `/api/${kebab(name)}`
  if (!PATH_RE.test(route)) {
    throw new Error(
      `Invalid path "${route}". It must start with /api/ and use only lowercase letters, digits, hyphens and :params.`,
    )
  }

  const isPublic = options.public === true
  const hasBody = BODY_METHODS.includes(method)
  const params = route
    .split('/')
    .filter((s) => s.startsWith(':'))
    .map((s) => s.slice(1))

  const baseDir = process.cwd()
  const language = await detectLanguage(baseDir)
  const isTs = language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const routesDir = path.join(baseDir, 'app', 'routes')
  await fs.mkdir(routesDir, { recursive: true })
  const filePath = path.join(routesDir, `${name}.${ext}`)

  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    console.log(`\n⚠ Already exists, not overwritten: ${path.relative(baseDir, filePath)}\n`)
    return
  }

  const wrapOpen = isPublic ? '' : 'auth('
  const wrapClose = isPublic ? '' : ')'
  const lines = []

  if (isTs) {
    lines.push("import type { Router, TylixRequest, TylixResponse } from '@tylix/core'", '')
    lines.push('type RouteContext = { auth: (handler: any) => any }', '')
    lines.push(
      `export async function routes(router: Router${isPublic ? '' : ', { auth }: RouteContext'}) {`,
    )
    lines.push(
      `  router.${method}('${route}', ${wrapOpen}async (req: TylixRequest, res: TylixResponse): Promise<void> => {`,
    )
  } else {
    lines.push(`export async function routes(router${isPublic ? '' : ', { auth }'}) {`)
    lines.push(`  router.${method}('${route}', ${wrapOpen}async (req, res) => {`)
  }

  lines.push('    try {')
  if (params.length > 0) {
    lines.push(
      isTs
        ? `      const { ${params.join(', ')} } = ((req as any).params ?? {}) as Record<string, string>`
        : `      const { ${params.join(', ')} } = req.params ?? {}`,
    )
  }
  if (hasBody) {
    lines.push(
      isTs
        ? '      const body = ((req as any).body ?? {}) as Record<string, unknown>'
        : '      const body = req.body ?? {}',
    )
  }
  lines.push(
    '',
    '      // TODO: validate input and implement',
    '      res.json({ ok: true })',
    '    } catch (err) {',
    `      console.error('${method.toUpperCase()} ${route} failed:', err)`,
    '      res.status(500)',
    "      res.json({ error: 'Something went wrong' })",
    '    }',
    `  }${wrapClose})`,
    '}',
    '',
  )

  await fs.writeFile(filePath, lines.join('\n'))

  const urlExpr =
    params.length > 0 ? '`' + route.replace(/:([A-Za-z_]\w*)/g, '${$1}') + '`' : `'${route}'`
  const callOptions = hasBody
    ? `, { method: '${method.toUpperCase()}', body: data }`
    : method === 'get'
      ? ''
      : `, { method: '${method.toUpperCase()}' }`

  console.log(`\n✔ Created: ${path.relative(baseDir, filePath)}`)
  console.log(`  ${method.toUpperCase()} ${route}  ${isPublic ? '(public)' : '(login required)'}`)
  console.log(`\n  Call it from a page:\n    useApi(${urlExpr}${callOptions})\n`)
}