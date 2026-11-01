import { emitStatementLines } from '../codegen/emitStatementLines.js'
import { generateParams } from '../codegen/generateExpression.js'
import { collectTemplateChecks } from './typedTemplateExpr.js'

// Recursively emits a check tree (see collectTemplateChecks) into
// the virtual __render() body. `each` entries open a real
// `for (const item of (iterable as any[]))` so the loop variable is
// an actual TS declaration, not a bare identifier the checker has
// never seen -- `as any[]` since state/props are typically `any`
// here anyway, and iterating `any` never fails strict mode regardless.
// The optional index binding of `{{#each item, i in items}}` is
// declared as a number.
function emitChecks(checks, sink, indent) {
  for (const c of checks) {
    if (c.kind === 'each') {
      sink.pushLine(
        `${indent}for (const ${c.itemName} of (${c.iterableExpr} as any[])) {`,
        c.line,
      )
      if (c.indexName) {
        sink.pushLine(`${indent}  const ${c.indexName}: number = 0;`, null)
      }
      emitChecks(c.children, sink, indent + '  ')
      sink.pushLine(`${indent}}`, null)
    } else if (c.eventType) {
      const base = c.eventBase ?? 'Event'
      const full = `${base} & { target: ${c.eventType} }`
      sink.pushLine(`${indent}{`, null)
      sink.pushLine(
        `${indent}  const event: ${full} = new Event("synthetic") as unknown as ${full};`,
        null,
      )
      sink.pushLine(`${indent}  const $event = event;`, null)
      sink.pushLine(`${indent}  (${c.expr});`, c.line)
      sink.pushLine(`${indent}}`, null)
    } else {
      sink.pushLine(`${indent}(${c.expr});`, c.line)
    }
  }
}

export function buildVirtualPageTs(pageNode, className, templateNodes = null) {
  const lines = []
  const lineMap = []
  const sink = {
    pushLine(text, originalLine) {
      if (originalLine != null) {
        lineMap.push({ virtualLine: lines.length + 1, originalLine })
      }
      lines.push(text)
    },
  }

  if (pageNode.props.length > 0) {
    sink.pushLine(`interface ${className}Props {`, null)
    for (const p of pageNode.props) {
      sink.pushLine(
        `  ${p.name}${p.optional ? '?' : ''}: ${p.propType};`,
        p.line,
      )
    }
    sink.pushLine(`}`, null)
    sink.pushLine(``, null)
  }

  sink.pushLine(`class ${className} {`, null)
  sink.pushLine(`  [key: string]: any;`, null)
  if (pageNode.props.length > 0) {
    sink.pushLine(`  props!: ${className}Props;`, null)
  }

  for (const s of pageNode.state) {
    sink.pushLine(`  ${s.name}!: ${s.typeAnnotation ?? 'any'};`, s.line)
  }

  for (const c of pageNode.computed) {
    sink.pushLine(``, null)
    sink.pushLine(
      `  get ${c.name}()${c.returnType ? `: ${c.returnType}` : ''} {`,
      c.line,
    )
    for (const stmt of c.body) emitStatementLines(stmt, sink, '    ')
    sink.pushLine(`  }`, null)
  }

  for (const a of pageNode.actions) {
    const returnType = a.returnType
      ? a.isAsync
        ? `Promise<${a.returnType}>`
        : a.returnType
      : ''
    sink.pushLine(``, null)
    sink.pushLine(
      `  ${a.isAsync ? 'async ' : ''}${a.name}(${generateParams(a.params, true)})${returnType ? `: ${returnType}` : ''} {`,
      a.line,
    )
    for (const stmt of a.body) emitStatementLines(stmt, sink, '    ')
    sink.pushLine(`  }`, null)
  }

  if (pageNode.onMount && pageNode.onMount.body.length > 0) {
    sink.pushLine(``, null)
    sink.pushLine(`  async __onMount(): Promise<any> {`, pageNode.onMount.line)
    for (const stmt of pageNode.onMount.body) {
      emitStatementLines(stmt, sink, '    ')
    }
    sink.pushLine(`  }`, null)
  }

  if (templateNodes) {
    const checks = []
    collectTemplateChecks(templateNodes, new Set(), checks)
    if (checks.length > 0) {
      sink.pushLine(``, null)
      // async so `await` inside event handlers typechecks
      sink.pushLine(`  async __render() {`, null)
      emitChecks(checks, sink, '    ')
      sink.pushLine(`  }`, null)
    }
  }

  sink.pushLine(`}`, null)

  return { source: lines.join('\n') + '\n', lineMap }
}

export function mapVirtualLineToSource(lineMap, virtualLine) {
  let best = lineMap[0]?.originalLine ?? 1
  for (const entry of lineMap) {
    if (entry.virtualLine <= virtualLine) best = entry.originalLine
    else break
  }
  return best
}