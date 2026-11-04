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

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

// Adds an import line after the last existing import (multi-line
// imports included), or at the top when the file has none.
function insertImport(source, line) {
  const importRe = /^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm
  let last = null
  for (const match of source.matchAll(importRe)) last = match
  if (!last) return `${line}\n${source}`
  const end = last.index + last[0].length
  return `${source.slice(0, end)}\n${line}${source.slice(end)}`
}

// Adds a line at the end of `export async function <fnName>(...) { ... }`.
// Returns null when the function is not found, so the caller can fall
// back to telling the developer what to paste.
function insertRoute(source, fnName, line) {
  const start = new RegExp(`export\\s+(async\\s+)?function\\s+${fnName}\\s*\\(`).exec(
    source,
  )
  if (!start) return null

  const open = source.indexOf('{', start.index + start[0].length)
  if (open === -1) return null

  let depth = 0
  let close = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) return null

  const before = source.slice(0, close)
  const prefix = before.endsWith('\n') ? '' : '\n'
  return `${before}${prefix}  ${line}\n${source.slice(close)}`
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
  const handlersDir = path.join(routesDir, 'handlers')
  await fs.mkdir(handlersDir, { recursive: true })

  const handlerName = `${name}Handler`
  const handlerPath = path.join(handlersDir, `${name}.${ext}`)
  const webPath = path.join(routesDir, `web.${ext}`)

  if (await pathExists(handlerPath)) {
    console.log(
      `\n⚠ Already exists, not overwritten: ${path.relative(baseDir, handlerPath)}\n`,
    )
    return
  }

  // ---- 1. The handler file (the part you edit) --------------------
  const lines = []

  if (isTs) {
    lines.push("import type { TylixRequest, TylixResponse } from '@tylix/core'", '')
    lines.push(
      `export async function ${handlerName}(req: TylixRequest, res: TylixResponse): Promise<void> {`,
    )
  } else {
    lines.push(`export async function ${handlerName}(req, res) {`)
  }

  lines.push('  try {')
  if (params.length > 0) {
    lines.push(
      isTs
        ? `    const { ${params.join(', ')} } = ((req as any).params ?? {}) as Record<string, string>`
        : `    const { ${params.join(', ')} } = req.params ?? {}`,
    )
  }
  if (hasBody) {
    lines.push(
      isTs
        ? '    const body = ((req as any).body ?? {}) as Record<string, unknown>'
        : '    const body = req.body ?? {}',
    )
  }
  lines.push(
    '',
    '    // TODO: validate input and implement',
    '    res.json({ ok: true })',
    '  } catch (err) {',
    `    console.error('${method.toUpperCase()} ${route} failed:', err)`,
    '    res.status(500)',
    "    res.json({ error: 'Something went wrong' })",
    '  }',
    '}',
    '',
  )

  await fs.writeFile(handlerPath, lines.join('\n'))

  // ---- 2. Register it in web.ts / web.js --------------------------
  const importLine = `import { ${handlerName} } from './handlers/${name}.js'`
  const routeLine = `router.${method}('${route}', (req, res) => ${handlerName}(req, res))`
  const section = isPublic ? 'publicRoutes' : 'protectedRoutes'

  let registered = false
  if (await pathExists(webPath)) {
    const source = await fs.readFile(webPath, 'utf-8')

    if (source.includes(`${handlerName}(`) || source.includes(`handlers/${name}.js`)) {
      registered = true // already wired up, leave web alone
    } else {
      const withRoute = insertRoute(source, section, routeLine)
      if (withRoute) {
        await fs.writeFile(webPath, insertImport(withRoute, importLine))
        registered = true
      }
    }
  }

  // ---- 3. Report --------------------------------------------------
  const urlExpr =
    params.length > 0 ? '`' + route.replace(/:([A-Za-z_]\w*)/g, '${$1}') + '`' : `'${route}'`
  const callOptions = hasBody
    ? `, { method: '${method.toUpperCase()}', body: data }`
    : method === 'get'
      ? ''
      : `, { method: '${method.toUpperCase()}' }`

  console.log(`\n✔ Created: ${path.relative(baseDir, handlerPath)}`)
  if (registered) {
    console.log(`✔ Registered in ${path.relative(baseDir, webPath)} under ${section}()`)
  } else {
    console.log(
      `⚠ Could not edit ${path.relative(baseDir, webPath)} (missing, or no ${section}() function).\n` +
        `  Add this yourself:\n    ${importLine}\n    ${routeLine}   // inside ${section}()`,
    )
  }
  console.log(`  ${method.toUpperCase()} ${route}  ${isPublic ? '(public)' : '(login required)'}`)
  console.log(`\n  Call it from a page:\n    useApi(${urlExpr}${callOptions})\n`)
}