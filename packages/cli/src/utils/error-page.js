export class CompileError extends Error {
  constructor(
    message,
    { line = null, column = null, file = null, source = null } = {},
  ) {
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

// Pattern-matched hints for error messages we've seen bite people
// before. Grows over time -- each entry here turns a confusing parser
// message into a self-service fix instead of a support question.
const KNOWN_ISSUES = [
  {
    test: /Expected ':' after object key.*got DOT/,
    hint: 'This usually means an arrow function has a block body — arrow functions here only support a single expression, not <code>{ ... }</code>. Try removing the braces: <code>(x) =&gt; expr</code> instead of <code>(x) =&gt; { expr }</code>.',
  },
  {
    test: /Unexpected token DOT/,
    hint: 'A decimal number written without a leading zero (like <code>.5</code>) lexes as a bare dot. Write <code>0.5</code> instead.',
  },
  {
    test: /Unclosed block: reached end of template looking for/,
    hint: 'A <code>{{#if}}</code> or <code>{{#each}}</code> is missing its matching <code>{{/if}}</code> or <code>{{/each}}</code>. Check for a block that was never closed above this point.',
  },
  {
    test: /Invalid \{\{#each\}\} header/,
    hint: 'The header inside <code>{{#each ...}}</code> must read as <code>item in items</code> — check for a typo in the "in" keyword or the collection name.',
  },
  {
    test: /Mismatched closing tag/,
    hint: 'An HTML tag was opened with one name and closed with another — check for a copy-paste mismatch, like <code>&lt;div&gt;...&lt;/span&gt;</code>.',
  },
]

function findHint(message) {
  const match = KNOWN_ISSUES.find((issue) => issue.test.test(message || ''))
  return match ? match.hint : null
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
      <div class="frame-line${isTarget ? ' frame-line--error' : ''}" id="${isTarget ? 'error-line' : ''}">
        <span class="frame-gutter">${isTarget ? '❯' : ''}${i}</span>
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
  const hint = findHint(error.message)
  const fileName = file.split('/').pop()
  const filePathParts = file.split('/')
  const fileDir = filePathParts.slice(0, -1).join('/')

  const copyPayload = escapeHtml(
    JSON.stringify({ file, line, message: error.message, stack }, null, 2),
  )

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Compile Error -- ${escapeHtml(fileName)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #020617; /* slate-950 */
    color: #e2e8f0; /* slate-200 */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  header {
    padding: 28px 40px;
    border-bottom: 1px solid #1e293b;
    background: #0f172a;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
  }

  .header-main { flex: 1; min-width: 0; }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f87171;
    font-weight: 600;
    margin: 0 0 12px;
  }
  .eyebrow::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #f87171;
    box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.15);
  }

  h1 {
    font-size: 21px;
    font-weight: 600;
    margin: 0 0 14px;
    color: #f1f5f9;
    line-height: 1.45;
    word-break: break-word;
  }

  .location {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 13px;
  }
  .location .dir { color: #64748b; }
  .location .file { color: #38bdf8; font-weight: 500; }
  .line-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #7dd3fc;
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    font-weight: 500;
  }

  .copy-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    font-size: 13px;
    font-family: inherit;
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .copy-btn:hover { background: #334155; border-color: #475569; }
  .copy-btn:active { transform: translateY(1px); }
  .copy-btn.copied { background: rgba(52, 211, 153, 0.15); border-color: rgba(52, 211, 153, 0.4); color: #6ee7b7; }

  main { padding: 32px 40px 60px; max-width: 980px; margin: 0 auto; }

  .hint {
    display: flex;
    gap: 12px;
    margin: 0 0 28px;
    padding: 14px 18px;
    border-radius: 10px;
    background: rgba(56, 189, 248, 0.07);
    border: 1px solid rgba(56, 189, 248, 0.22);
    color: #bae6fd;
    font-size: 13.5px;
    line-height: 1.65;
  }
  .hint-icon { flex-shrink: 0; font-size: 16px; line-height: 1.6; }
  .hint code {
    background: rgba(148, 163, 184, 0.15);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 12.5px;
    color: #e2e8f0;
  }

  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748b;
    margin: 0 0 12px;
    font-weight: 600;
  }

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
    line-height: 1.75;
    border-left: 3px solid transparent;
  }
  .frame-line--error {
    background: rgba(248, 113, 113, 0.12);
    border-left-color: #f87171;
  }
  .frame-gutter {
    flex: 0 0 52px;
    text-align: right;
    padding-right: 14px;
    color: #475569;
    user-select: none;
    position: relative;
  }
  .frame-line--error .frame-gutter { color: #f87171; font-weight: 600; }
  .frame-code {
    white-space: pre;
    color: #cbd5e1;
    padding-right: 20px;
  }
  .frame-line--error .frame-code { color: #fecaca; }

  details.stack-details {
    border: 1px solid #1e293b;
    border-radius: 10px;
    overflow: hidden;
    background: #0b1220;
  }
  details.stack-details summary {
    cursor: pointer;
    padding: 14px 20px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748b;
    font-weight: 600;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }
  details.stack-details summary::-webkit-details-marker { display: none; }
  details.stack-details summary::before {
    content: "▸";
    display: inline-block;
    transition: transform 0.15s;
    color: #475569;
  }
  details.stack-details[open] summary::before { transform: rotate(90deg); }
  details.stack-details summary:hover { color: #94a3b8; }

  pre.stack {
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 12.5px;
    color: #94a3b8;
    padding: 4px 24px 20px;
    margin: 0;
    overflow-x: auto;
    white-space: pre-wrap;
    border-top: 1px solid #1e293b;
  }

  footer {
    max-width: 980px;
    margin: 0 auto;
    padding: 0 40px 40px;
    color: #475569;
    font-size: 12px;
  }

  @media (max-width: 640px) {
    header { flex-direction: column; }
    header, main, footer { padding-left: 20px; padding-right: 20px; }
  }
</style>
</head>
<body>
  <header>
    <div class="header-main">
      <p class="eyebrow">Compile Error</p>
      <h1>${escapeHtml(error.message)}</h1>
      <div class="location">
        ${fileDir ? `<span class="dir">${escapeHtml(fileDir)}/</span>` : ''}<span class="file">${escapeHtml(fileName)}</span>
        ${line ? `<span class="line-pill">Line ${line}</span>` : ''}
      </div>
    </div>
    <button class="copy-btn" onclick="copyErrorDetails(this)">
      <span>📋</span> Copy details
    </button>
  </header>
  <main>
    ${
      hint
        ? `
    <div class="hint">
      <span class="hint-icon">💡</span>
      <span>${hint}</span>
    </div>`
        : ''
    }

    ${
      source && line
        ? `
    <h2>Source</h2>
    <div class="frame">${renderCodeFrame(source, line)}</div>`
        : ''
    }

    ${
      stack
        ? `
    <details class="stack-details">
      <summary>Stack Trace</summary>
      <pre class="stack">${escapeHtml(stack)}</pre>
    </details>`
        : ''
    }
  </main>
  <footer>Tylix will keep serving this page until the file compiles — save to retry.</footer>

  <script>
    function copyErrorDetails(btn) {
      const payload = ${JSON.stringify(copyPayload)}.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      navigator.clipboard.writeText(payload).then(() => {
        const original = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = '<span>✓</span> Copied';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = original;
        }, 1800);
      });
    }

    document.getElementById('error-line')?.scrollIntoView({ block: 'center' });
  </script>
</body>
</html>`
}
