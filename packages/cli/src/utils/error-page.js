/**
 * CompileError -- a structured error for Lexer/Parser failures.
 *
 * Today, Lexer.js and Parser.js do `throw new Error("... at line N")`.
 * That's fine for a console, but a debug page needs the line number
 * as data, not buried in a sentence. This wraps the same message in
 * an error that also carries `.line`, `.file`, and (optionally) the
 * source text, so nothing downstream has to regex it back apart.
 *
 * Minimal-diff way to adopt it in Lexer.js / Parser.js: swap
 *   throw new Error(`Unexpected token ${type} at line ${line}`)
 * for
 *   throw new CompileError(`Unexpected token ${type}`, { line, file })
 * -- one call site at a time, no rush, both keep working since
 * CompileError still has a normal `.message`.
 */
export class CompileError extends Error {
  constructor(message, { line = null, column = null, file = null, source = null } = {}) {
    super(message)
    this.name = 'CompileError'
    this.line = line
    this.column = column
    this.file = file
    this.source = source
  }
}

// Fallback for errors that haven't been migrated to CompileError yet --
// pulls "at line N" back out of a plain Error's message so the page
// can still show a code frame.
function extractLine(message) {
  const match = /at line (\d+)/.exec(message || '')
  return match ? Number(match[1]) : null
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Builds the highlighted source excerpt -- a handful of lines either
// side of the failing one, offending line picked out in red with a
// left-border marker, gutter numbers dimmed like most editors.
function renderCodeFrame(source, line, contextLines = 6) {
  if (!source || !line) return ''

  const lines = source.split('\n')
  const start = Math.max(1, line - contextLines)
  const end = Math.min(lines.length, line + contextLines)

  let rows = ''
  for (let i = start; i <= end; i++) {
    const isTarget = i === line
    const content = escapeHtml(lines[i - 1] ?? '')
    rows += `
      <div class="frame-line${isTarget ? ' frame-line--error' : ''}">
        <span class="frame-gutter">${i}</span>
        <span class="frame-code">${content || ' '}</span>
      </div>`
  }
  return rows
}

/**
 * renderErrorPage(error, opts) -> HTML string
 *
 * error: a CompileError, or any Error (line is recovered from the
 *        message if it's not already a CompileError).
 * opts.file:   path to show in the header, if not already on the error
 * opts.source: full source text of the file being compiled, so a
 *              code frame can be shown (omit and you just get the
 *              message + stack, still far better than a blank page)
 */
export function renderErrorPage(error, opts = {}) {
  const file = error.file || opts.file || 'unknown file'
  const line = error.line ?? extractLine(error.message)
  const source = error.source || opts.source || null
  const stack = error.stack || ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Compile Error -- ${escapeHtml(file)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #020617; /* slate-950 */
    color: #e2e8f0; /* slate-200 */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  header {
    padding: 28px 40px;
    border-bottom: 1px solid #1e293b;
    background: #0f172a;
  }
  .eyebrow {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f87171;
    font-weight: 600;
    margin: 0 0 10px;
  }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 10px;
    color: #f1f5f9;
    line-height: 1.4;
  }
  .location {
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 13px;
    color: #94a3b8;
  }
  .location strong { color: #38bdf8; font-weight: 500; }
  main { padding: 32px 40px 60px; max-width: 980px; margin: 0 auto; }
  .frame {
    border: 1px solid #1e293b;
    border-radius: 10px;
    overflow: hidden;
    background: #0b1220;
    margin-bottom: 32px;
  }
  .frame-line {
    display: flex;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 13px;
    line-height: 1.7;
    border-left: 3px solid transparent;
  }
  .frame-line--error {
    background: rgba(248, 113, 113, 0.12);
    border-left-color: #f87171;
  }
  .frame-gutter {
    flex: 0 0 48px;
    text-align: right;
    padding-right: 16px;
    color: #475569;
    user-select: none;
  }
  .frame-line--error .frame-gutter { color: #f87171; }
  .frame-code {
    white-space: pre;
    color: #cbd5e1;
  }
  .frame-line--error .frame-code { color: #fecaca; }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    margin: 0 0 12px;
  }
  pre.stack {
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 12.5px;
    color: #94a3b8;
    background: #0b1220;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 20px 24px;
    overflow-x: auto;
    white-space: pre-wrap;
  }
</style>
</head>
<body>
  <header>
    <p class="eyebrow">Compile Error</p>
    <h1>${escapeHtml(error.message)}</h1>
    <p class="location">
      <strong>${escapeHtml(file)}</strong>${line ? ` : line ${line}` : ''}
    </p>
  </header>
  <main>
    ${source && line ? `
    <h2>Source</h2>
    <div class="frame">${renderCodeFrame(source, line)}</div>` : ''}
    ${stack ? `
    <h2>Stack Trace</h2>
    <pre class="stack">${escapeHtml(stack)}</pre>` : ''}
  </main>
</body>
</html>`
}
