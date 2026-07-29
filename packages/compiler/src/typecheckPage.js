import { parsePageFile } from './parser/parsePageFile.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import {
  buildVirtualPageTs,
  mapVirtualLineToSource,
} from './typecheck/buildVirtualTs.js'
import { typecheckSource } from './typecheck/typecheckVirtualFile.js'

export function typecheckPage(source, pageName) {
  const { script, template, scriptStartLine } = parsePageFile(source)

  const pageNode =
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize()).parse()
      : { props: [], state: [], computed: [], actions: [] }

  const templateNodes =
    template.trim().length > 0 ? parseTemplate(template) : null

  const { source: virtualSource, lineMap } = buildVirtualPageTs(
    pageNode,
    pageName,
    templateNodes,
  )
  const diagnostics = typecheckSource(virtualSource)

  return diagnostics.map((d) => {
    const scriptLine = mapVirtualLineToSource(lineMap, d.virtualLine)
    return { message: d.message, line: scriptLine + scriptStartLine - 1 }
  })
}
