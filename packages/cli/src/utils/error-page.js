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
  {
    test: /Unterminated interpolation: missing/,
    hint: 'An <code>{{ }}</code> interpolation is missing its closing <code>}}</code> — check for a stray single <code>}</code>.',
  },
]

function findHint(message) {
  const match = KNOWN_ISSUES.find((issue) => issue.test.test(message || ''))
  return match ? match.hint : null
}

function renderCodeFrame(source, line, contextLines = 2) {
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
        <span class="frame-marker">${isTarget ? '>' : ''}</span>
        <span class="frame-gutter">${i}</span>
        <span class="frame-code">${content}</span>
      </div>`
  }
  return rows
}

export function renderErrorPage(error, opts = {}) {
  const file = error.file || opts.file || 'unknown file'
  const line = error.line ?? extractLine(error.message)
  const source = error.source || opts.source || null
  const stack = error.stack || ''
  const hint = findHint(error.message)
  const fileName = file.split('/').pop()
  const offendingLine =
    source && line ? (source.split('\n')[line - 1] || '').trim() : null

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
    background: #020617;
    color: #e2e8f0;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    -webkit-font-smoothing: antialiased;
  }

  header {
    padding: 28px 40px 22px;
    border-bottom: 1px solid #334155;
  }

  .eyebrow {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f87171;
    font-weight: 600;
    margin: 0 0 10px;
  }

  .file-line { color: #38bdf8; font-size: 14px; margin: 0 0 4px; }
  .line-num { color: #64748b; font-size: 13px; margin: 0 0 16px; }

  .offending-code {
    background: #0b1220;
    border-left: 3px solid #f87171;
    color: #fecaca;
    padding: 10px 14px;
    font-size: 13px;
    margin: 0 0 12px;
    white-space: pre;
    overflow-x: auto;
  }

  .message {
    color: #e2e8f0;
    font-size: 14px;
    margin: 0;
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    font-size: 12.5px;
    font-family: inherit;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    margin-top: 16px;
  }
  .copy-btn:hover { background: #334155; }
  .copy-btn.copied { background: rgba(52, 211, 153, 0.15); border-color: rgba(52, 211, 153, 0.4); color: #6ee7b7; }

  main { padding: 24px 40px 50px; max-width: 900px; margin: 0 auto; }

  .hint {
    display: flex;
    gap: 10px;
    margin: 0 0 24px;
    padding: 12px 16px;
    border-left: 3px solid #38bdf8;
    background: #0b1220;
    color: #bae6fd;
    font-size: 13px;
    line-height: 1.6;
  }
  .hint code {
    background: rgba(148, 163, 184, 0.15);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    color: #e2e8f0;
  }

  .frame {
    border-top: 1px solid #334155;
    border-bottom: 1px solid #334155;
    padding: 8px 0;
    margin: 0 0 28px;
  }
  .frame-line {
    display: flex;
    font-size: 13px;
    line-height: 1.8;
  }
  .frame-marker { flex: 0 0 20px; color: #f87171; font-weight: 700; text-align: center; }
  .frame-gutter { flex: 0 0 40px; color: #475569; text-align: right; padding-right: 16px; }
  .frame-line--error .frame-gutter { color: #f87171; }
  .frame-code { white-space: pre; color: #cbd5e1; }
  .frame-line--error .frame-code { color: #fecaca; }

  details.stack-details {
    border-top: 1px solid #334155;
    padding-top: 12px;
  }
  details.stack-details summary {
    cursor: pointer;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    list-style: none;
  }
  details.stack-details summary::-webkit-details-marker { display: none; }
  details.stack-details summary::before { content: "▸ "; }
  details.stack-details[open] summary::before { content: "▾ "; }

  pre.stack {
    font-size: 12px;
    color: #94a3b8;
    padding: 12px 0 0;
    margin: 0;
    overflow-x: auto;
    white-space: pre-wrap;
  }
</style>
</head>
<body>
  <header>
    <p class="eyebrow">Template Compile Error</p>
    <p class="file-line">${escapeHtml(fileName)}</p>
    ${line ? `<p class="line-num">Line ${line}</p>` : ''}
    ${offendingLine ? `<p class="offending-code">${escapeHtml(offendingLine)}</p>` : ''}
    <p class="message">${escapeHtml(error.message)}</p>
    <button class="copy-btn" onclick="copyErrorDetails(this)">📋 Copy details</button>
  </header>
  <main>
    ${hint ? `<div class="hint">💡 <span>${hint}</span></div>` : ''}

    ${source && line ? `<div class="frame">${renderCodeFrame(source, line)}</div>` : ''}

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

  <script>
    function copyErrorDetails(btn) {
      const payload = ${JSON.stringify(copyPayload)}.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      navigator.clipboard.writeText(payload).then(() => {
        const original = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = '✓ Copied';
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
