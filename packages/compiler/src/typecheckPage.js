import { parsePageFile } from './parser/parsePageFile.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import { normalizeLanguageOptions } from './parser/languageOptions.js'
import {
  buildVirtualPageTs,
  mapVirtualLineToSource,
} from './typecheck/buildVirtualTs.js'
import { typecheckSource } from './typecheck/typecheckVirtualFile.js'
import { substituteCapabilityRefs } from './ast/substituteCapabilityRefs.js'

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
//
// `source` must already have its import lines blanked out by
// extractImports() (which keeps line numbers intact), or any page with
// an `import` line fails to parse here.
//
// `languageOption` must be the same object passed to
// renderPageDocument ({ not: 'loose' } etc.): the typechecker has to
// parse the page the same way the real build does, or it would report
// on a different program than the one that runs.
export function typecheckPage(
  source,
  apiHelpersSource = '',
  languageOption = {},
) {
  // createApp has a variable named `language` that holds
  // 'typescript' | 'javascript'. Passing that here by mistake would
  // silently fall back to defaults, so refuse it loudly.
  if (languageOption !== null && typeof languageOption !== 'object') {
    throw new Error(
      `typecheckPage: the language options must be an object like { not: 'loose' }, got ${typeof languageOption} "${languageOption}"`,
    )
  }
  const language = normalizeLanguageOptions(languageOption ?? {})

  const { pageName, script, template, scriptStartLine } = parsePageFile(source)

  const pageNode = substituteCapabilityRefs(
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize(), language).parse()
      : { props: [], state: [], computed: [], actions: [], onMount: null },
  )

  const templateNodes =
    template.trim().length > 0 ? parseTemplate(template, language) : null

  const { source: virtualSource, lineMap } = buildVirtualPageTs(
    pageNode,
    pageName,
    templateNodes,
  )
  const diagnostics = typecheckSource(virtualSource, apiHelpersSource)

  return diagnostics.map((d) => {
    const scriptLine = mapVirtualLineToSource(lineMap, d.virtualLine)
    return { message: d.message, line: scriptLine + scriptStartLine - 1 }
  })
}