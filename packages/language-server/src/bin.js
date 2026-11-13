#!/usr/bin/env node
// tylix-language-server --stdio
// For editors other than VS Code (Neovim, Helix, Zed, Sublime LSP...):
// run this with --stdio and associate it with *.tyx files.
import { startServer } from './server.js'

startServer()
