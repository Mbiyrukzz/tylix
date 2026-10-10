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
        <span class="frame-marker">${isTarget ? '›' : ''}</span>
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
<title>Compile Error — ${escapeHtml(fileName)}</title>
<script>
  (function () {
    var stored = localStorage.getItem("theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) {
      document.documentElement.classList.add("dark");
    }
  })();
</script>
<style>
  * { box-sizing: border-box; }

  :root {
    --bg-page: #e2e8f0;        /* slate-200 */
    --bg-card: #f8fafc;        /* slate-50 */
    --bg-inset: #cbd5e1;       /* slate-300, used sparingly for insets */
    --border: #cbd5e1;         /* slate-300 */
    --border-strong: #94a3b8;  /* slate-400 */
    --text-primary: #1e293b;   /* slate-800 */
    --text-secondary: #64748b; /* slate-500 */
    --text-muted: #94a3b8;     /* slate-400 */
    --accent: #047857;         /* emerald-700 */
    --accent-soft: rgba(16, 185, 129, 0.1);
    --accent-ring: rgba(16, 185, 129, 0.25);
    --danger: #be123c;         /* rose-700 */
    --danger-border: #fda4af;  /* rose-300 */
    --danger-bg: #ffe4e6;      /* rose-100 */
    --code-bg: #f1f5f9;        /* slate-100 */
  }

  html.dark {
    --bg-page: #020617;        /* slate-950 */
    --bg-card: #0f172a;        /* slate-900 */
    --bg-inset: #1e293b;       /* slate-800 */
    --border: #1e293b;         /* slate-800 */
    --border-strong: #334155;  /* slate-700 */
    --text-primary: #e2e8f0;   /* slate-200 */
    --text-secondary: #94a3b8; /* slate-400 */
    --text-muted: #64748b;     /* slate-500 */
    --accent: #10b981;         /* emerald-500 */
    --accent-soft: rgba(16, 185, 129, 0.12);
    --accent-ring: rgba(16, 185, 129, 0.3);
    --danger: #fb7185;         /* rose-400 */
    --danger-border: rgba(159, 18, 57, 0.5);
    --danger-bg: rgba(76, 5, 25, 0.3);
    --code-bg: #0b1220;
  }

  body {
    margin: 0;
    background: var(--bg-page);
    color: var(--text-primary);
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    -webkit-font-smoothing: antialiased;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .shell {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 24px;
  }

  .card {
    width: 100%;
    max-width: 860px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  html.dark .card {
    box-shadow: none;
  }

  header {
    padding: 28px 32px 24px;
    border-bottom: 1px solid var(--border);
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--danger);
    font-weight: 700;
    margin: 0 0 14px;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--danger-bg);
    border: 1px solid var(--danger-border);
  }

  .file-line {
    color: var(--accent);
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 4px;
    word-break: break-all;
  }

  .line-num {
    color: var(--text-muted);
    font-size: 12.5px;
    margin: 0 0 18px;
  }

  .offending-code {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-left: 3px solid var(--danger);
    border-radius: 8px;
    color: var(--text-primary);
    padding: 12px 14px;
    font-size: 13px;
    margin: 0 0 14px;
    white-space: pre;
    overflow-x: auto;
  }

  .message {
    color: var(--text-primary);
    font-size: 14px;
    line-height: 1.6;
    margin: 0;
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-inset);
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    font-size: 12.5px;
    font-family: inherit;
    padding: 7px 14px;
    border-radius: 999px;
    cursor: pointer;
    margin-top: 18px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }
  .copy-btn:hover { background: var(--border-strong); }
  .copy-btn.copied {
    background: var(--accent-soft);
    border-color: var(--accent-ring);
    color: var(--accent);
  }

  main { padding: 24px 32px 32px; }

  .hint {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0 0 24px;
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--accent-ring);
    background: var(--accent-soft);
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.65;
  }
  .hint-icon { color: var(--accent); flex-shrink: 0; margin-top: 1px; }
  .hint code {
    background: var(--bg-inset);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-primary);
  }

  .frame {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px 0;
    margin: 0 0 28px;
    overflow: hidden;
    background: var(--code-bg);
  }
  .frame-line {
    display: flex;
    font-size: 13px;
    line-height: 1.85;
    padding: 0 4px;
  }
  .frame-marker { flex: 0 0 20px; color: var(--danger); font-weight: 700; text-align: center; }
  .frame-gutter { flex: 0 0 40px; color: var(--text-muted); text-align: right; padding-right: 16px; user-select: none; }
  .frame-line--error {
    background: var(--danger-bg);
  }
  .frame-line--error .frame-gutter { color: var(--danger); font-weight: 600; }
  .frame-code { white-space: pre; color: var(--text-secondary); }
  .frame-line--error .frame-code { color: var(--text-primary); }

  details.stack-details {
    border-top: 1px solid var(--border);
    padding-top: 14px;
  }
  details.stack-details summary {
    cursor: pointer;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    list-style: none;
    font-weight: 600;
  }
  details.stack-details summary::-webkit-details-marker { display: none; }
  details.stack-details summary::before { content: "▸ "; }
  details.stack-details[open] summary::before { content: "▾ "; }

  pre.stack {
    font-size: 12px;
    color: var(--text-secondary);
    padding: 12px 0 0;
    margin: 0;
    overflow-x: auto;
    white-space: pre-wrap;
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <header>
        <span class="eyebrow">⚠ Template Compile Error</span>
        <p class="file-line">${escapeHtml(fileName)}</p>
        ${line ? `<p class="line-num">Line ${line}</p>` : ''}
        ${offendingLine ? `<p class="offending-code">${escapeHtml(offendingLine)}</p>` : ''}
        <p class="message">${escapeHtml(error.message)}</p>
        <button class="copy-btn" onclick="copyErrorDetails(this)">📋 Copy details</button>
      </header>
      <main>
        ${hint ? `<div class="hint"><span class="hint-icon">💡</span><span>${hint}</span></div>` : ''}

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
    </div>
  </div>

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
