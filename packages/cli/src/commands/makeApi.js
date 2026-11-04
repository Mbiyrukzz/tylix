import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

const METHODS = ['get', 'post', 'put', 'delete']
const BODY_METHODS = ['post', 'put']
const NAME_RE = /^[a-z][a-zA-Z0-9]*$/
const PATH_RE = /^\/api(\/([a-z0-9-]+|:[A-Za-z_]\w*))+$/

// app/routes/web.* is the hand-written routes file and is loaded on its
// own, so a generated file must never take that name.
const RESERVED_NAMES = new Set(['web'])

function kebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

export async function makeApi(name, options = {}) {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid name "${name}". Use letters and digits, starting with a lowercase letter (e.g. contact, getPost).`,
    )
  }

  if (RESERVED_NAMES.has(name)) {
    throw new Error(
      `"${name}" is reserved: app/routes/${name}.* is loaded separately. Pick another name.`,
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

  // The file is mounted automatically by registerRouteFiles, because it
  // exports routes(router, { auth }). It has no @tylix-feature marker on
  // purpose: that marker tells the framework a make:feature file owns a
  // table, and this file does not.
  const filePath = path.join(routesDir, `${name}.${ext}`)

  if (await pathExists(filePath)) {
    console.log(
      `\n⚠ Already exists, not overwritten: ${path.relative(baseDir, filePath)}\n`,
    )
    return
  }

  const reqRes = isTs ? '(req: TylixRequest, res: TylixResponse)' : '(req, res)'
  const open = isPublic
    ? `  router.${method}('${route}', async ${reqRes} => {`
    : `  router.${method}('${route}', auth(async ${reqRes} => {`
  const close = isPublic ? '  })' : '  }))'

  const lines = [
    '// Written by make:api. Mounted automatically from app/routes/.',
    '',
  ]

  if (isTs) {
    lines.push("import type { Router, TylixRequest, TylixResponse } from '@tylix/core'", '')
    if (!isPublic) {
      lines.push('type RouteContext = { auth: (handler: any) => any }', '')
    }
    lines.push(
      isPublic
        ? 'export async function routes(router: Router) {'
        : 'export async function routes(router: Router, { auth }: RouteContext) {',
    )
  } else {
    lines.push(
      isPublic
        ? 'export async function routes(router) {'
        : 'export async function routes(router, { auth }) {',
    )
  }

  lines.push(open, '    try {')
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
    close,
    '}',
    '',
  )

  await fs.writeFile(filePath, lines.join('\n'))

  // ---- Report -----------------------------------------------------
  const urlExpr =
    params.length > 0 ? '`' + route.replace(/:([A-Za-z_]\w*)/g, '${$1}') + '`' : `'${route}'`
  const callOptions = hasBody
    ? `, { method: '${method.toUpperCase()}', body: data }`
    : method === 'get'
      ? ''
      : `, { method: '${method.toUpperCase()}' }`

  console.log(`\n✔ Created: ${path.relative(baseDir, filePath)}`)
  console.log('  Mounted automatically on startup (no changes to web.' + ext + ')')
  console.log(`  ${method.toUpperCase()} ${route}  ${isPublic ? '(public)' : '(login required)'}`)
  console.log(`\n  Call it from a page:\n    useApi(${urlExpr}${callOptions})\n`)
}