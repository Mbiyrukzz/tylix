const IMPORT_LINE_RE =
  /^\s*import\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']\s*;?\s*$/gm

// Tylix pages/components can import named components from an
// installed package (e.g. `import { IconCheck, IconTrash } from
// "tylix-icons"`), the same way a local component under
// app/pages/components/ works -- this is a source-level rewrite
// step, not a grammar addition. Import lines never reach
// parsePageFile's script/template splitter or the Parser/Lexer at
// all; they're stripped out of the raw file text before any of that
// runs. Only package specifiers (no leading "." or "/") are handled
// here -- local components are already auto-discovered by
// loadComponents() scanning app/pages/components/, so a relative
// import isn't a case this needs to cover.
export function extractImports(source) {
  const imports = []
  const cleaned = source.replace(IMPORT_LINE_RE, (match, namesRaw, pkg) => {
    if (pkg.startsWith('.') || pkg.startsWith('/')) {
      return match // not a supported target -- leave as a normal parse error
    }
    const names = namesRaw
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    imports.push({ names, package: pkg })
    return ''
  })
  return { imports, source: cleaned }
}
