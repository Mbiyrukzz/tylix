// Tylix language server: diagnostics, completion, hover, go to
// definition and document symbols for .tyx files, over LSP.
//
// Diagnostics come from @tylix/compiler's diagnoseTyx: syntax errors as
// you type, then (in TypeScript projects) a typecheck shortly after you
// stop typing. Files that don't start with `page`, `component` or
// `capability` (generator templates and other .tyx text) get none.
//
// initializationOptions:
//   trusted    false keeps the server on its bundled compiler instead of
//              loading the project's (default true)
//   typecheck  'auto' (TypeScript projects) | 'always' | 'never'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import lsp from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { completions, definition, documentSymbols, hover } from './analysis.js'
import {
  createCapabilityIndex,
  findProjectRoot,
  isTypeScriptProject,
  loadCompiler,
  readApiHelpers,
  readCompilerOptions,
  resolveImport,
} from './project.js'

const {
  createConnection,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} = lsp

const SYNTAX_DELAY_MS = 120
const TYPECHECK_DELAY_MS = 600

function toDiagnostic(d) {
  return {
    range: {
      start: { line: d.line - 1, character: d.column - 1 },
      end: { line: d.endLine - 1, character: d.endColumn - 1 },
    },
    severity: DiagnosticSeverity.Error,
    source: 'tylix',
    code: d.origin,
    message: d.message,
  }
}

export function startServer(connection = createConnection(ProposedFeatures.all)) {
  const documents = new TextDocuments(TextDocument)
  const projects = new Map() // root -> Promise<project>
  const analyses = new Map() // uri -> { version, text, kind, symbols, imports, file }
  const timers = new Map() // uri -> timeout
  let settings = { trusted: true, typecheck: 'auto' }

  const fileOf = (uri) => (uri.startsWith('file:') ? fileURLToPath(uri) : null)

  function openText(file) {
    const doc = documents.get(pathToFileURL(file).href)
    return doc ? doc.getText() : null
  }

  function projectFor(file) {
    const root = findProjectRoot(file)
    if (!projects.has(root)) {
      projects.set(
        root,
        loadCompiler(root, { trusted: settings.trusted }).then(({ compiler, source }) => {
          connection.console.log(`[tylix] ${root}: using compiler ${source}`)
          return {
            root,
            compiler,
            capabilities: createCapabilityIndex(root, compiler.diagnoseTyx, openText),
          }
        }),
      )
    }
    return projects.get(root)
  }

  function projectView(project, file) {
    return {
      capabilities: project.capabilities(),
      resolveImport: (specifier) => resolveImport(file, specifier),
    }
  }

  // Parses the document (syntax only), keeps the outline for completion
  // and publishes; then queues a typecheck when the project wants one.
  async function analyse(doc, { typecheck }) {
    const file = fileOf(doc.uri) ?? path.join(process.cwd(), 'untitled.tyx')
    const project = await projectFor(file)
    const text = doc.getText()
    const version = doc.version
    const language = readCompilerOptions(project.root)
    const wantTypes =
      settings.typecheck === 'always' ||
      (settings.typecheck === 'auto' && isTypeScriptProject(project.root))

    const result = project.compiler.diagnoseTyx(text, {
      language,
      typecheck: typecheck && wantTypes,
      apiHelpersSource: typecheck && wantTypes ? readApiHelpers(project.root) : '',
    })
    if (documents.get(doc.uri)?.version !== version) return // stale

    // While the file doesn't parse, keep the last good outline so
    // completion still knows the names.
    const previous = analyses.get(doc.uri)
    const symbols =
      result.symbols.length === 0 && result.diagnostics.length > 0 && previous
        ? previous.symbols
        : result.symbols
    analyses.set(doc.uri, {
      version,
      text,
      file,
      kind: result.kind,
      symbols,
      imports: result.imports.length ? result.imports : previous?.imports ?? [],
    })

    connection.sendDiagnostics({
      uri: doc.uri,
      version,
      diagnostics: result.diagnostics.map(toDiagnostic),
    })

    if (!typecheck && wantTypes && result.kind !== 'other' && result.kind !== 'capability' && result.diagnostics.length === 0) {
      schedule(doc, TYPECHECK_DELAY_MS, true)
    }
  }

  function schedule(doc, delay, typecheck) {
    clearTimeout(timers.get(doc.uri))
    timers.set(
      doc.uri,
      setTimeout(() => {
        timers.delete(doc.uri)
        const current = documents.get(doc.uri)
        if (current) {
          analyse(current, { typecheck }).catch((err) =>
            connection.console.error(`[tylix] ${err.stack ?? err}`),
          )
        }
      }, delay),
    )
  }

  // Analysis of the document as it is now (completion can arrive
  // before the debounced pass has run).
  async function current(uri) {
    const doc = documents.get(uri)
    if (!doc) return null
    const cached = analyses.get(uri)
    if (cached && cached.version === doc.version) return cached
    await analyse(doc, { typecheck: false })
    return analyses.get(uri) ?? null
  }

  connection.onInitialize((params) => {
    const opts = params.initializationOptions ?? {}
    settings = {
      trusted: opts.trusted !== false,
      typecheck: ['auto', 'always', 'never'].includes(opts.typecheck) ? opts.typecheck : 'auto',
    }
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ['.', '<', '{', '#'] },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
      },
      serverInfo: { name: 'tylix-language-server' },
    }
  })

  connection.onDidChangeConfiguration((change) => {
    const t = change.settings?.tylix?.typecheck
    if (['auto', 'always', 'never'].includes(t)) settings.typecheck = t
    for (const doc of documents.all()) schedule(doc, SYNTAX_DELAY_MS, false)
  })

  documents.onDidOpen(({ document }) => schedule(document, 0, false))
  documents.onDidChangeContent(({ document }) => schedule(document, SYNTAX_DELAY_MS, false))
  documents.onDidSave(({ document }) => schedule(document, 0, false))
  documents.onDidClose(({ document }) => {
    clearTimeout(timers.get(document.uri))
    analyses.delete(document.uri)
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] })
  })

  connection.onCompletion(async ({ textDocument, position }) => {
    const doc = await current(textDocument.uri)
    if (!doc || doc.kind === 'other') return []
    const project = await projectFor(doc.file)
    return completions(doc, position, projectView(project, doc.file))
  })

  connection.onHover(async ({ textDocument, position }) => {
    const doc = await current(textDocument.uri)
    if (!doc || doc.kind === 'other') return null
    const project = await projectFor(doc.file)
    return hover(doc, position, projectView(project, doc.file))
  })

  connection.onDefinition(async ({ textDocument, position }) => {
    const doc = await current(textDocument.uri)
    if (!doc || doc.kind === 'other') return null
    const project = await projectFor(doc.file)
    const found = definition(doc, position, projectView(project, doc.file))
    if (!found) return null
    return {
      uri: found.uri === 'self' ? textDocument.uri : pathToFileURL(found.uri).href,
      range: found.range,
    }
  })

  connection.onDocumentSymbol(async ({ textDocument }) => {
    const doc = await current(textDocument.uri)
    return doc && doc.kind !== 'other' ? documentSymbols(doc) : []
  })

  documents.listen(connection)
  connection.listen()
  return connection
}
