// VS Code client for the Tylix language server (bundled as
// dist/server.cjs from packages/language-server).
const path = require('node:path')
const vscode = require('vscode')
const { LanguageClient, TransportKind } = require('vscode-languageclient/node')

let client = null

function createClient(context) {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.cjs'))
  const config = vscode.workspace.getConfiguration('tylix')
  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6029'] },
    },
  }
  const clientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'tyx' },
      { scheme: 'untitled', language: 'tyx' },
    ],
    initializationOptions: {
      // Untrusted folders never get their own @tylix/compiler loaded.
      trusted: vscode.workspace.isTrusted,
      typecheck: config.get('typecheck', 'auto'),
    },
    synchronize: { configurationSection: 'tylix' },
  }
  return new LanguageClient('tylix', 'Tylix', serverOptions, clientOptions)
}

async function restart(context) {
  if (client) await client.stop().catch(() => {})
  client = createClient(context)
  await client.start()
}

async function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('tylix.restartServer', () => restart(context)),
    vscode.commands.registerCommand('tylix.showOutput', () => client?.outputChannel.show()),
    // Trust changes which compiler the server may load.
    vscode.workspace.onDidGrantWorkspaceTrust(() => restart(context)),
  )
  await restart(context)
}

async function deactivate() {
  if (client) await client.stop()
}

module.exports = { activate, deactivate }
