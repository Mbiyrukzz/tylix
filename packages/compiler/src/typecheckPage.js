import { parsePageFile } from './parser/parsePageFile.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import {
  buildVirtualPageTs,
  mapVirtualLineToSource,
} from './typecheck/buildVirtualTs.js'
import { typecheckSource } from './typecheck/typecheckVirtualFile.js'

// Derives the virtual class/interface name from the page's own
// `page <Name>` declaration (via parsePageFile) -- the same source
// of truth generatePage already uses for the REAL compiled class --
// rather than the file's path/basename. File names and page names
// can legitimately differ (app/pages/post/post-detail.tyx declaring
// `page PostDetail`), and a kebab-case basename like "post-detail"
// isn't a valid TS class name -- using it verbatim produces
// `class post-detail { ... }`, which fails to parse as TypeScript
// at all and floods the diagnostics list with dozens of
// cascading-recovery errors, none of which point at anything wrong
// in the actual .tyx source.
export function typecheckPage(source) {
  const { pageName, script, template, scriptStartLine } = parsePageFile(source)

  const pageNode =
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize()).parse()
      : { props: [], state: [], computed: [], actions: [], onMount: null }

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
