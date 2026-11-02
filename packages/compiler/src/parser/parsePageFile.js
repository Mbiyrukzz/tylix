// Locates the top-level `uses | state | computed | action | template |
// style` section keywords. A keyword only counts when:
//   - it is the first thing on its line, and
//   - it is not followed by `:` `(` `=` or `,` (that makes it a field
//     or attribute name, e.g. `style: "dark"` or `style="..."`), and
//   - before the template: it sits at brace/paren depth 0, so keys
//     inside action bodies and object literals are ignored. Strings,
//     template literals and comments are skipped while tracking depth.
//   - after the template starts: only `style` is looked for (the
//     template body is HTML, where quotes and braces mean nothing).
const SECTION_RE = /^(uses|state|computed|action|template|style)(?![\w$])/

export function findSectionBoundaries(source) {
  const boundaries = []
  const n = source.length
  let i = 0
  let depth = 0
  let lineStart = true
  let inTemplate = false

  while (i < n) {
    const c = source[i]

    if (c === '\n') {
      lineStart = true
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }

    if (lineStart) {
      lineStart = false
      const m = SECTION_RE.exec(source.slice(i, i + 16))
      if (m) {
        const keyword = m[1]
        let j = i + keyword.length
        while (source[j] === ' ' || source[j] === '\t') j++
        const next = source[j]
        const isFieldName =
          next === ':' || next === '(' || next === '=' || next === ','
        const allowed = inTemplate ? keyword === 'style' : depth === 0
        if (!isFieldName && allowed) {
          boundaries.push({
            keyword,
            start: i,
            contentStart: i + keyword.length,
          })
          if (keyword === 'template') inTemplate = true
          i += keyword.length
          continue
        }
      }
    }

    if (inTemplate) {
      i++
      continue
    }

    // --- script-mode scanning ---
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      i = close === -1 ? n : close + 2
      continue
    }
    if (c === '"' || c === "'") {
      i++
      // A quote never spans lines, so a stray one (inside a regex
      // literal, say) can't swallow the rest of the file.
      while (i < n && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\') i++
        i++
      }
      if (source[i] === c) i++
      continue
    }
    if (c === '`') {
      i++
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1)
    i++
  }

  return boundaries
}

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
  const templateBoundary = boundaries.find((b) => b.keyword === 'template')
  const styleBoundary = boundaries.find((b) => b.keyword === 'style')

  if (!templateBoundary) {
    throw new Error('.tyx file is missing a required "template" section.')
  }

  // A section's content runs until the next template/style keyword,
  // or the end of the file -- so `style` written before `template`
  // no longer swallows the template.
  const contentBoundaries = [templateBoundary, styleBoundary].filter(Boolean)
  const endOf = (b) =>
    contentBoundaries
      .filter((x) => x.start > b.start)
      .map((x) => x.start)
      .sort((a, c) => a - c)[0] ?? afterPageDeclaration.length

  const scriptEnd = Math.min(...contentBoundaries.map((b) => b.start))
  const rawScriptSource = afterPageDeclaration.slice(0, scriptEnd)
  const scriptSource = rawScriptSource.trim()

  const leadingWhitespaceLength =
    rawScriptSource.length - rawScriptSource.trimStart().length
  const trimmedPrefix = rawScriptSource.slice(0, leadingWhitespaceLength)
  const linesBeforeScript =
    source.slice(0, pageMatch.index + pageMatch[0].length).split('\n').length -
    1
  const scriptStartLine = linesBeforeScript + trimmedPrefix.split('\n').length

  const rawTemplateSource = afterPageDeclaration.slice(
    templateBoundary.contentStart,
    endOf(templateBoundary),
  )
  const template = rawTemplateSource.trim()

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
  const templateStartLine =
    linesBeforeTemplate + templateTrimmedPrefix.split('\n').length

  const style = styleBoundary
    ? afterPageDeclaration
        .slice(styleBoundary.contentStart, endOf(styleBoundary))
        .trim()
    : ''

  return {
    pageName,
    script: scriptSource,
    template,
    style,
    scriptStartLine,
    templateStartLine,
  }
}