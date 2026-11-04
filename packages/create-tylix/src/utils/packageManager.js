
export function getPackageManager(config) {
  return config.packageManager === 'pnpm' ? 'pnpm' : 'npm'
}

// Install all dependencies of the project in the current directory.
export function installCommand(pm) {
  return `${pm} install`
}

// Run a binary from the project's node_modules/.bin,
// e.g. execCommand('pnpm', 'tylix migrate') -> "pnpm exec tylix migrate".
export function execCommand(pm, command) {
  return pm === 'pnpm' ? `pnpm exec ${command}` : `npx ${command}`
}

// Run a script from package.json, e.g. runScriptCommand('pnpm', 'dev').
// `run` is always spelled out because some script names clash with
// built-in package manager commands.
export function runScriptCommand(pm, script) {
  return `${pm} run ${script}`
}