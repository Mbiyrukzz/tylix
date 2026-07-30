import ts from 'typescript'

// Transpiles a single .ts source file to plain, browser-runnable JS.
// Used for app/useApi/*.ts helpers, which get concatenated as raw
// text into the page's inline <script> and executed directly in the
// browser -- unlike pages themselves (which go through
// generatePage/generateTemplate), these files are handed to the
// browser close to verbatim, so any TypeScript syntax in them (type
// annotations, etc.) has to be stripped before they can run there.
//
// transpileModule (not the full typecheckSource/checker path) is
// deliberate here: these are simple, single-file helper functions
// with no cross-file type information to check against, and the
// project's own typecheckPage already covers .tyx pages -- this is
// purely a syntax-stripping step, not a second typechecking pass.
export function transpileTsToJs(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  return result.outputText
}
