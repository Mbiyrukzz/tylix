const HEADER_RE = /^component\s+(\w+)/

/**
 * Splits a bare-keyword "component Name" file into { componentName,
 * script, template }, mirroring parsePageFile's page/script/template
 * split. The header line is consumed and discarded; everything up to
 * the top-level "template" keyword is script (state/action/onMount),
 * everything after is template body -- same split point parsePageFile
 * must use, since Parser.isSectionKeyword() never includes TEMPLATE.
 */
export function parseComponentFile(source) {
  const headerMatch = HEADER_RE.exec(source)
  if (!headerMatch) {
    throw new Error('.tyx component file must start with "component Name"')
  }
  const componentName = headerMatch[1]

  const afterHeader = source.slice(headerMatch.index + headerMatch[0].length)

  const templateMatch = /^[ \t]*template\b/m.exec(afterHeader)
  if (!templateMatch) {
    throw new Error(
      `Component "${componentName}" is missing a template section.`,
    )
  }

  const script = afterHeader.slice(0, templateMatch.index).trim()
  const template = afterHeader
    .slice(templateMatch.index + templateMatch[0].length)
    .trim()

  return { componentName, script, template }
}
