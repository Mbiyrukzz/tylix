/**
 * Parses Tylix's native .tyx file format -- no <script>/<template>
 * wrapper tags, just top-level keyword sections:
 *
 *   page Home
 *
 *   state
 *     count: 0
 *
 *   action
 *     increment() { this.count = this.count + 1 }
 *
 *   template
 *     <div>{{ count }}</div>
 *
 * "template" and "style" mark the start of raw (non-script) content
 * that runs to the next top-level section keyword or end of file, so
 * this is a lightweight text split, not full tokenization -- the
 * script portion (page/state/computed/action) is handed to the real
 * Lexer/Parser; template/style content is handled by their own
 * dedicated parsers (parseTemplate, and style is passed through as-is).
 */
const SECTION_KEYWORDS = ['state', 'computed', 'action', 'template', 'style']

export function parsePageFile(source) {
  const pageMatch = /^\s*page\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(source)
  if (!pageMatch) {
    throw new Error('.tyx file must start with "page <Name>"')
  }
  const pageName = pageMatch[1]

  const afterPageDeclaration = source.slice(
    pageMatch.index + pageMatch[0].length,
  )

  const boundaries = findSectionBoundaries(afterPageDeclaration)

  const scriptEnd =
    boundaries.find((b) => b.keyword === 'template')?.start ??
    afterPageDeclaration.length
  const scriptSource = afterPageDeclaration.slice(0, scriptEnd).trim()

  const templateBoundary = boundaries.find((b) => b.keyword === 'template')
  const styleBoundary = boundaries.find((b) => b.keyword === 'style')

  let template = ''
  if (templateBoundary) {
    const templateEnd =
      styleBoundary && styleBoundary.start > templateBoundary.start
        ? styleBoundary.start
        : afterPageDeclaration.length
    template = afterPageDeclaration
      .slice(templateBoundary.contentStart, templateEnd)
      .trim()
  }

  let style = ''
  if (styleBoundary) {
    style = afterPageDeclaration.slice(styleBoundary.contentStart).trim()
  }

  if (!templateBoundary) {
    throw new Error('.tyx file is missing a required "template" section.')
  }

  return { pageName, script: scriptSource, template, style }
}

// Finds each top-level section keyword that appears at the start of
// its own line (ignoring leading whitespace), returning its position
// and where its content begins (right after the keyword itself).
export function findSectionBoundaries(source) {
  const boundaries = []
  const lineStartPattern =
    /(^|\n)[ \t]*(state|computed|action|template|style)\b/g
  let match
  while ((match = lineStartPattern.exec(source)) !== null) {
    const keyword = match[2]
    const keywordStart = match.index + match[0].indexOf(keyword)
    boundaries.push({
      keyword,
      start: keywordStart,
      contentStart: keywordStart + keyword.length,
    })
  }
  return boundaries
}
