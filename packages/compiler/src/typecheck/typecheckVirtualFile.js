import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const VIRTUAL_FILE_NAME = '__tylix_virtual_page.ts'
const API_HELPERS_VIRTUAL_FILE_NAME = '__tylix_virtual_api_helpers.ts'
const GLOBALS_FILE = fileURLToPath(
  new URL('./tylix-globals.d.ts', import.meta.url),
)

export function typecheckSource(
  virtualSource,
  apiHelpersSource = '',
  compilerOptions = {},
) {
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
    if (fileName === API_HELPERS_VIRTUAL_FILE_NAME) {
      return ts.createSourceFile(
        fileName,
        apiHelpersSource,
        languageVersion,
        true,
      )
    }
    return originalGetSourceFile(fileName, languageVersion, ...rest)
  }
  host.fileExists = (fileName) =>
    fileName === VIRTUAL_FILE_NAME ||
    fileName === API_HELPERS_VIRTUAL_FILE_NAME ||
    ts.sys.fileExists(fileName)
  host.readFile = (fileName) => {
    if (fileName === VIRTUAL_FILE_NAME) return virtualSource
    if (fileName === API_HELPERS_VIRTUAL_FILE_NAME) return apiHelpersSource
    return ts.sys.readFile(fileName)
  }

  const rootFiles = apiHelpersSource
    ? [VIRTUAL_FILE_NAME, API_HELPERS_VIRTUAL_FILE_NAME, GLOBALS_FILE]
    : [VIRTUAL_FILE_NAME, GLOBALS_FILE]

  const program = ts.createProgram(rootFiles, options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)

  return diagnostics
    .filter((d) => d.file && d.file.fileName === VIRTUAL_FILE_NAME)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n')
      const { line } = d.file.getLineAndCharacterOfPosition(d.start)
      return { message, virtualLine: line + 1 }
    })
}
