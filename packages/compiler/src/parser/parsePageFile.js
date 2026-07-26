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
  const rawScriptSource = afterPageDeclaration.slice(0, scriptEnd)
  const scriptSource = rawScriptSource.trim()

  const leadingWhitespaceLength =
    rawScriptSource.length - rawScriptSource.trimStart().length
  const trimmedPrefix = rawScriptSource.slice(0, leadingWhitespaceLength)
  const linesBeforeScript =
    source.slice(0, pageMatch.index + pageMatch[0].length).split('\n').length -
    1
  const scriptStartLine = linesBeforeScript + trimmedPrefix.split('\n').length

  const templateBoundary = boundaries.find((b) => b.keyword === 'template')
  const styleBoundary = boundaries.find((b) => b.keyword === 'style')

  let template = ''
  let templateStartLine = null
  if (templateBoundary) {
    const templateEnd =
      styleBoundary && styleBoundary.start > templateBoundary.start
        ? styleBoundary.start
        : afterPageDeclaration.length
    const rawTemplateSource = afterPageDeclaration.slice(
      templateBoundary.contentStart,
      templateEnd,
    )
    template = rawTemplateSource.trim()

    const templateLeadingWhitespaceLength =
      rawTemplateSource.length - rawTemplateSource.trimStart().length
    const templateTrimmedPrefix = rawTemplateSource.slice(
      0,
      templateLeadingWhitespaceLength,
    )
    const absoluteContentStart =
      pageMatch.index + pageMatch[0].length + templateBoundary.contentStart
    const linesBeforeTemplate =
      source.slice(0, absoluteContentStart).split('\n').length - 1
    templateStartLine =
      linesBeforeTemplate + templateTrimmedPrefix.split('\n').length
  }

  let style = ''
  if (styleBoundary) {
    style = afterPageDeclaration.slice(styleBoundary.contentStart).trim()
  }

  if (!templateBoundary) {
    throw new Error('.tyx file is missing a required "template" section.')
  }

  return {
    pageName,
    script: scriptSource,
    template,
    style,
    scriptStartLine,
    templateStartLine,
  }
}

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
