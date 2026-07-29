import { emitStatementLines } from '../codegen/emitStatementLines.js'
import { collectTemplateChecks } from './typedTemplateExpr.js'

function paramListWithTypes(params) {
  return params
    .map(
      (p) =>
        `${p.name}${p.typeAnnotation ? `: ${p.typeAnnotation}` : ': unknown'}`,
    )
    .join(', ')
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
      `  ${a.isAsync ? 'async ' : ''}${a.name}(${paramListWithTypes(a.params)})${returnType ? `: ${returnType}` : ''} {`,
      a.line,
    )
    for (const stmt of a.body) emitStatementLines(stmt, sink, '    ')
    sink.pushLine(`  }`, null)
  }

  if (templateNodes) {
    const checks = []
    collectTemplateChecks(templateNodes, new Set(), checks)
    if (checks.length > 0) {
      sink.pushLine(``, null)
      sink.pushLine(`  __render() {`, null)
      for (const { expr, line, eventType } of checks) {
        if (eventType) {
          // Block-scoped so each event binding gets its own
          // correctly-typed $event, instead of one shared untyped
          // Event forcing every oninput/onchange binding to fail
          // strict-null checks on $event.target.
          sink.pushLine(`    {`, null)
          sink.pushLine(
            `      const $event: Event & { target: ${eventType} } = new Event("synthetic") as unknown as Event & { target: ${eventType} };`,
            null,
          )
          sink.pushLine(`      (${expr});`, line)
          sink.pushLine(`    }`, null)
        } else {
          sink.pushLine(`    (${expr});`, line)
        }
      }
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
