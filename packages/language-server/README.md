# @tylix/language-server

A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server for Tylix `.tyx` files. The Tylix VS Code extension bundles it; other editors can run it directly.

- Errors as you type, at the exact line and column, from `@tylix/compiler`
- Type checking in TypeScript projects (`tsconfig.json` or `tylix.config.ts`)
- Completion: members in `{{ }}` and after `this.`, `{{#each}}` loop variables, capabilities and their members, imported components, section keywords
- Hover, go to definition, document outline

Only files that start with `page`, `component` or `capability` are analysed. Other `.tyx` files (code-generator templates) get no diagnostics.

## Use it from any editor

```sh
npm install -g @tylix/language-server
tylix-language-server --stdio
```

Neovim (0.11+):

```lua
vim.filetype.add({ extension = { tyx = 'tyx' } })
vim.lsp.config('tylix', {
  cmd = { 'tylix-language-server', '--stdio' },
  filetypes = { 'tyx' },
  root_markers = { 'tylix.config.ts', 'tylix.config.js', 'package.json' },
})
vim.lsp.enable('tylix')
```

Helix (`languages.toml`):

```toml
[language-server.tylix]
command = "tylix-language-server"
args = ["--stdio"]

[[language]]
name = "tyx"
scope = "source.tyx"
file-types = ["tyx"]
language-servers = ["tylix"]
```

## Initialization options

| Option | Default | |
| --- | --- | --- |
| `trusted` | `true` | `false` keeps the server on its own bundled compiler and never loads `@tylix/compiler` from the project. |
| `typecheck` | `"auto"` | `"auto"` (TypeScript projects), `"always"` or `"never"`. |

Compiler switches such as `compiler: { not: 'loose' }` are read from the project's `tylix.config` file as text. The config is never executed.

## Embedding

```js
import { startServer } from '@tylix/language-server'
startServer() // uses createConnection(ProposedFeatures.all): --stdio, --node-ipc or --socket
```

`@tylix/language-server/analysis` exports the editor-independent pieces (`completions`, `hover`, `definition`, `documentSymbols`).
