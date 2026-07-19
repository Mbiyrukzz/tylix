/**
 * Parses a native "component Name" .tyx file -- structurally
 * identical to parsePageFile's "page Name" format (same state/
 * computed/action/template/style sections, same boundary-finding),
 * just a different header keyword and no page-specific semantics.
 */
import { findSectionBoundaries } from './parsePageFile.js'

export function parseComponentFile(source) {
  const componentMatch = /^\s*component\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
    source,
  )
  if (!componentMatch) {
    throw new Error('.tyx component file must start with "component <Name>"')
  }
  const componentName = componentMatch[1]

  const afterDeclaration = source.slice(
    componentMatch.index + componentMatch[0].length,
  )

  const boundaries = findSectionBoundaries(afterDeclaration)

  const scriptEnd =
    boundaries.find((b) => b.keyword === 'template')?.start ??
    afterDeclaration.length
  const scriptSource = afterDeclaration.slice(0, scriptEnd).trim()

  const templateBoundary = boundaries.find((b) => b.keyword === 'template')
  const styleBoundary = boundaries.find((b) => b.keyword === 'style')

  let template = ''
  if (templateBoundary) {
    const templateEnd =
      styleBoundary && styleBoundary.start > templateBoundary.start
        ? styleBoundary.start
        : afterDeclaration.length
    template = afterDeclaration
      .slice(templateBoundary.contentStart, templateEnd)
      .trim()
  }

  let style = ''
  if (styleBoundary) {
    style = afterDeclaration.slice(styleBoundary.contentStart).trim()
  }

  if (!templateBoundary) {
    throw new Error(
      `Component "${componentName}" is missing a required "template" section.`,
    )
  }

  return { componentName, script: scriptSource, template, style }
}
