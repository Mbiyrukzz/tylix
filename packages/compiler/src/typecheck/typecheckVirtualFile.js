import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const VIRTUAL_FILE_NAME = '__tylix_virtual_page.ts'
const GLOBALS_FILE = fileURLToPath(
  new URL('./tylix-globals.d.ts', import.meta.url),
)

export function typecheckSource(virtualSource, compilerOptions = {}) {
  const options = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    skipLibCheck: true,
    ...compilerOptions,
  }

  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    if (fileName === VIRTUAL_FILE_NAME) {
      return ts.createSourceFile(fileName, virtualSource, languageVersion, true)
    }
    return originalGetSourceFile(fileName, languageVersion, ...rest)
  }
  host.fileExists = (fileName) =>
    fileName === VIRTUAL_FILE_NAME || ts.sys.fileExists(fileName)
  host.readFile = (fileName) =>
    fileName === VIRTUAL_FILE_NAME ? virtualSource : ts.sys.readFile(fileName)

  const program = ts.createProgram(
    [VIRTUAL_FILE_NAME, GLOBALS_FILE],
    options,
    host,
  )
  const diagnostics = ts.getPreEmitDiagnostics(program)

  return diagnostics
    .filter((d) => d.file && d.file.fileName === VIRTUAL_FILE_NAME)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n')
      const { line } = d.file.getLineAndCharacterOfPosition(d.start)
      return { message, virtualLine: line + 1 }
    })
}
