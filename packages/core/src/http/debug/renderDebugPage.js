const SQL_KEYWORDS = new Set(
  (
    'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER ADD DROP COLUMN ' +
    'INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES JOIN LEFT RIGHT INNER OUTER ON AS AND OR NOT NULL ' +
    'IN IS LIKE ORDER BY GROUP HAVING LIMIT OFFSET ASC DESC DISTINCT COUNT RETURNING IF EXISTS ' +
    'DEFAULT AUTO_INCREMENT AUTOINCREMENT'
  ).split(' '),
)

const JS_KEYWORDS = new Set(
  (
    'const let var function return if else for while await async new throw try catch finally class ' +
    'import export from default of in typeof instanceof null undefined true false this extends static ' +
    'switch case break continue yield delete void super'
  ).split(' '),
)

const DRIVER_LABELS = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
}

const STATUS_TEXT = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
}

const ICONS = {
  sun: '<svg class="i i-sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i i-moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function splitPath(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? ['', p] : [p.slice(0, i + 1), p.slice(i + 1)]
}

function absolutePath(file, cwd) {
  if (!file) return ''
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file
  return `${String(cwd).replace(/[\\/]$/, '')}/${file}`
}

// ---------------------------------------------------------------
// Highlighters (server side, so the page needs no libraries)
// ---------------------------------------------------------------

function highlightSql(sql, culprits) {
  const re =
    /('(?:[^'\\]|\\.)*')|(`[^`]*`|"[^"]*")|(\?|\$\d+)|(\d+(?:\.\d+)?)|([A-Za-z_][\w]*)/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(sql))) {
    out += esc(sql.slice(last, m.index))
    const [token, str, quoted, placeholder, num, word] = m
    if (str) out += `<span class="t-str">${esc(token)}</span>`
    else if (quoted) {
      const culprit = culprits.has(token.slice(1, -1))
      out += `<span class="${culprit ? 't-culprit' : 't-id'}">${esc(token)}</span>`
    } else if (placeholder) out += `<span class="t-ph">${esc(token)}</span>`
    else if (num) out += `<span class="t-num">${esc(token)}</span>`
    else if (SQL_KEYWORDS.has(word.toUpperCase()))
      out += `<span class="t-kw">${esc(token)}</span>`
    else if (culprits.has(word)) out += `<span class="t-culprit">${esc(token)}</span>`
    else out += esc(token)
    last = re.lastIndex
  }
  return out + esc(sql.slice(last))
}

// One line at a time: good enough for a snippet, and never throws.
function highlightJs(line) {
  const re =
    /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index))
    const [token, comment, str, num, word] = m
    if (comment) out += `<span class="t-com">${esc(token)}</span>`
    else if (str) out += `<span class="t-str">${esc(token)}</span>`
    else if (num) out += `<span class="t-num">${esc(token)}</span>`
    else if (JS_KEYWORDS.has(word)) out += `<span class="t-kw">${esc(token)}</span>`
    else if (line[re.lastIndex] === '(') out += `<span class="t-fn">${esc(token)}</span>`
    else out += esc(token)
    last = re.lastIndex
  }
  return out + esc(line.slice(last))
}

// ---------------------------------------------------------------
// Sections
// ---------------------------------------------------------------

function renderSource(source, cwd) {
  if (!source) return ''
  const abs = absolutePath(source.file, cwd)
  const [dir, base] = splitPath(source.file)
  const rows = source.lines
    .map((text, i) => {
      const n = source.start + i
      const hit = n === source.line
      return `<div class="cl${hit ? ' cl--hit' : ''}"><span class="cl-mark">${
        hit ? '›' : ''
      }</span><span class="cl-n">${n}</span><span class="cl-t">${highlightJs(text) || ' '}</span></div>`
    })
    .join('')
  return `<section class="card block">
    <div class="card-head">
      <h2>Where it happened</h2>
      <div class="card-tools">
        <a class="btn btn-sm" href="vscode://file/${esc(abs)}:${source.line}:${source.column}">${ICONS.external}<span>Open in VS Code</span></a>
        <button class="btn btn-sm" data-copy="path">${ICONS.copy}<span>Copy path</span></button>
      </div>
    </div>
    <div class="filebar mono"><span class="dir">${esc(dir)}</span><b>${esc(base)}</b><span class="pos">:${source.line}:${source.column}</span></div>
    <div class="code">${rows}</div>
  </section>`
}

function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function renderSql(p) {
  if (!p.sql) return ''
  const culprits = new Set([p.table, p.column].filter(Boolean))
  const params = (p.params ?? []).length
    ? `<div class="params"><h3>Parameters</h3>${p.params
        .map(
          (v, i) =>
            `<div class="param"><span class="pi">${i + 1}</span><span class="pv mono">${esc(
              JSON.stringify(v) ?? String(v),
            )}</span><span class="pt">${typeOf(v)}</span></div>`,
        )
        .join('')}</div>`
    : ''
  return `<section class="card block">
    <div class="card-head">
      <h2>${p.driver === 'mongodb' ? 'Operation' : 'Query'}</h2>
      <div class="card-tools"><button class="btn btn-sm" data-copy="sql">${ICONS.copy}<span>Copy</span></button></div>
    </div>
    <div class="sql-grid${params ? ' has-params' : ''}">
      <pre class="sql mono">${highlightSql(p.sql, culprits)}</pre>${params}
    </div>
  </section>`
}

function renderFrames(frames) {
  if (!frames.length) return '<p class="muted">No stack frames available.</p>'
  const firstApp = frames.findIndex((f) => f.kind === 'app')
  const hidden = frames.filter((f) => f.kind !== 'app').length
  const items = frames
    .map((f, i) => {
      const [dir, base] = splitPath(f.short)
      return `<li class="frame ${f.kind}${i === firstApp ? ' frame--first' : ''}">
        <span class="fi">${i + 1}</span>
        <div class="fmain">
          <span class="ffn">${esc(f.fn || '<anonymous>')}</span>
          <span class="floc mono"><span class="dir">${esc(dir)}</span><b>${esc(base)}</b><span class="pos">:${f.line}:${f.column}</span></span>
        </div>
        ${
          f.kind === 'app'
            ? '<span class="tag tag-app">your code</span>'
            : `<span class="tag">${f.kind === 'internal' ? 'node' : 'framework'}</span>`
        }
      </li>`
    })
    .join('')
  return `<div class="toolbar">
      <label class="switch"><input type="checkbox" id="show-vendor" /><span class="slider"></span>
        <span>Show framework and Node frames (${hidden})</span></label>
      <button class="btn btn-sm" data-copy="stack">${ICONS.copy}<span>Copy stack</span></button>
    </div>
    <ol class="frames" id="frames">${items}</ol>`
}

function kvRows(obj) {
  const entries = Object.entries(obj ?? {})
  if (!entries.length) return '<p class="muted">None</p>'
  return `<div class="kv">${entries
    .map(
      ([k, v]) =>
        `<div class="kv-row"><span class="kv-k mono">${esc(k)}</span><span class="kv-v mono">${esc(
          typeof v === 'object' && v !== null ? JSON.stringify(v) : v,
        )}</span></div>`,
    )
    .join('')}</div>`
}

function glance(p) {
  const rows = [
    ['Status', `${p.status} ${STATUS_TEXT[p.status] ?? ''}`.trim()],
    ['Type', p.name],
    ['Driver', p.driver ? (DRIVER_LABELS[p.driver] ?? p.driver) : null],
    ['Kind', p.kind ? p.kind.replace(/_/g, ' ') : null],
    ['Code', p.code],
    ['Table', p.table],
    ['Column', p.column],
    ['Detail', p.detail],
    ['Time', new Date().toLocaleTimeString('en-GB')],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '')
  return `<aside class="card glance"><h2>At a glance</h2>${rows
    .map(
      ([k, v]) =>
        `<div class="g-row"><span class="g-k">${esc(k)}</span><span class="g-v mono">${esc(v)}</span></div>`,
    )
    .join('')}</aside>`
}

// ---------------------------------------------------------------
// Browser script. Serialized with toString(), so it must not
// reference anything from this module.
// ---------------------------------------------------------------
function clientMain() {
  var data = JSON.parse(document.getElementById('debug-data').textContent)
  var FENCE = String.fromCharCode(96, 96, 96)
  var NL = String.fromCharCode(10)
  var toastTimer = null

  function absPath() {
    if (!data.source) return ''
    var f = data.source.file
    var abs = f.charAt(0) === '/' || /^[A-Za-z]:[\\/]/.test(f) ? f : data.env.cwd.replace(/[\\/]$/, '') + '/' + f
    return abs + ':' + data.source.line + ':' + data.source.column
  }

  function stackText() {
    return data.frames
      .map(function (f) {
        return 'at ' + (f.fn || '<anonymous>') + ' (' + f.file + ':' + f.line + ':' + f.column + ')'
      })
      .join(NL)
  }

  function toMarkdown(p) {
    var L = []
    L.push('## ' + (p.title || p.name), '')
    L.push('**' + p.name + (p.driver ? ' (' + p.driver + ')' : '') + ':** ' + p.message)
    if (p.hint) L.push('', '**Hint:** ' + p.hint)
    if (p.sql) {
      L.push('', FENCE + 'sql', p.sql, FENCE)
      if (p.params && p.params.length) L.push('Params: ' + JSON.stringify(p.params))
    }
    L.push('', '**Request:** ' + p.request.method + ' ' + p.request.url)
    var app = p.frames.filter(function (f) { return f.kind === 'app' }).slice(0, 8)
    if (app.length) {
      L.push('', FENCE)
      app.forEach(function (f) {
        L.push('at ' + (f.fn || '<anonymous>') + ' (' + f.short + ':' + f.line + ':' + f.column + ')')
      })
      L.push(FENCE)
    }
    return L.join(NL)
  }

  function toast(text) {
    var el = document.getElementById('toast')
    el.textContent = text
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { el.classList.remove('show') }, 1600)
  }

  function copy(text, label) {
    function done() { toast(label + ' copied') }
    function fallback() {
      var ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch (e) {}
      document.body.removeChild(ta)
      done()
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback)
    } else fallback()
  }

  var COPY = {
    sql: function () { return [data.sql, 'SQL'] },
    json: function () { return [JSON.stringify(data, null, 2), 'JSON'] },
    raw: function () { return [JSON.stringify(data, null, 2), 'JSON'] },
    md: function () { return [toMarkdown(data), 'Markdown'] },
    path: function () { return [absPath(), 'Path'] },
    stack: function () { return [stackText(), 'Stack trace'] }
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pair = COPY[btn.getAttribute('data-copy')]()
      copy(pair[0], pair[1])
    })
  })

  var tabs = ['overview', 'stack', 'request', 'raw']
  function showTab(name) {
    if (tabs.indexOf(name) < 0) name = 'overview'
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name)
    })
    document.querySelectorAll('.panel').forEach(function (p) {
      p.hidden = p.id !== 'panel-' + name
    })
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-tab')
      showTab(name)
      history.replaceState(null, '', '#' + name)
    })
  })
  showTab(location.hash.slice(1))

  var vendor = document.getElementById('show-vendor')
  if (vendor) {
    vendor.addEventListener('change', function () {
      document.getElementById('frames').classList.toggle('show-all', vendor.checked)
    })
  }

  function toggleTheme() {
    var dark = document.documentElement.classList.toggle('dark')
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch (e) {}
  }
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme)

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    var tag = (e.target && e.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    var n = parseInt(e.key, 10)
    if (n >= 1 && n <= tabs.length) {
      showTab(tabs[n - 1])
      history.replaceState(null, '', '#' + tabs[n - 1])
    } else if (e.key === 't') toggleTheme()
  })
}

// ---------------------------------------------------------------
// Styles
// ---------------------------------------------------------------
const CSS = `
* { box-sizing: border-box; }
:root {
  --bg:#eef2f7; --surface:#ffffff; --surface-2:#f6f8fb; --border:#dde3ec; --border-strong:#c3ccd9;
  --text:#0f172a; --text-2:#475569; --text-3:#8492a6;
  --accent:#059669; --accent-soft:rgba(5,150,105,.09); --accent-ring:rgba(5,150,105,.28);
  --danger:#e11d48; --danger-soft:rgba(225,29,72,.08); --danger-ring:rgba(225,29,72,.3);
  --warn:#b45309; --warn-soft:rgba(245,158,11,.12);
  --code-bg:#f6f8fb; --shadow:0 1px 2px rgba(15,23,42,.05), 0 8px 24px rgba(15,23,42,.05);
  --kw:#7c3aed; --str:#047857; --num:#b45309; --com:#94a3b8; --fn:#2563eb;
}
html.dark {
  --bg:#050816; --surface:#0d1424; --surface-2:#0a101e; --border:#1c2740; --border-strong:#2b3a5c;
  --text:#e6edf8; --text-2:#9aa8c2; --text-3:#64748b;
  --accent:#34d399; --accent-soft:rgba(52,211,153,.1); --accent-ring:rgba(52,211,153,.3);
  --danger:#fb7185; --danger-soft:rgba(251,113,133,.1); --danger-ring:rgba(251,113,133,.35);
  --warn:#fbbf24; --warn-soft:rgba(251,191,36,.1);
  --code-bg:#080d1a; --shadow:none;
  --kw:#c4b5fd; --str:#6ee7b7; --num:#fbbf24; --com:#5b6b8a; --fn:#7dd3fc;
}
html { color-scheme: light; } html.dark { color-scheme: dark; }
body { margin:0; background:var(--bg); color:var(--text); -webkit-font-smoothing:antialiased;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif; font-size:14px; line-height:1.55; }
.mono, pre, code { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Consolas, monospace; }
.i { display:block; } html.dark .i-moon { display:none; } html:not(.dark) .i-sun { display:none; }

/* top bar */
.topbar { position:sticky; top:0; z-index:10; background:color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter:blur(10px); border-bottom:1px solid var(--border); }
.topbar-in { max-width:1120px; margin:0 auto; padding:10px 24px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:.01em; }
.logo { width:26px; height:26px; border-radius:8px; display:grid; place-items:center; color:#fff;
  background:linear-gradient(135deg,#10b981,#059669); }
.brand small { font-weight:600; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-3);
  border:1px solid var(--border-strong); border-radius:999px; padding:1px 8px; }
.top-right { display:flex; align-items:center; gap:10px; color:var(--text-3); font-size:12px; }

.shell { max-width:1120px; margin:0 auto; padding:28px 24px 48px; }

/* buttons */
.btn { font:inherit; font-size:13px; font-weight:500; display:inline-flex; align-items:center; gap:7px; padding:7px 14px;
  border-radius:10px; cursor:pointer; text-decoration:none; color:var(--text); background:var(--surface);
  border:1px solid var(--border-strong); transition:border-color .12s, background .12s, transform .05s; }
.btn:hover { border-color:var(--accent); background:var(--accent-soft); }
.btn:active { transform:translateY(1px); }
.btn-sm { font-size:12px; padding:5px 10px; border-radius:8px; }
.btn-icon { padding:7px; }

/* hero */
.hero { position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--border);
  border-radius:18px; padding:28px 30px 24px; box-shadow:var(--shadow); }
.hero::before { content:""; position:absolute; inset:0 0 auto 0; height:4px; background:linear-gradient(90deg,var(--danger),#f97316); }
.hero::after { content:""; position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(600px 160px at 0% 0%, var(--danger-soft), transparent 70%); }
.hero > * { position:relative; z-index:1; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.chip { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:3px 10px;
  border-radius:999px; border:1px solid var(--border-strong); color:var(--text-2); background:var(--surface-2); }
.chip.danger { color:var(--danger); background:var(--danger-soft); border-color:var(--danger-ring); }
.chip.accent { color:var(--accent); background:var(--accent-soft); border-color:var(--accent-ring); }
h1 { font-size:28px; line-height:1.25; margin:0 0 12px; font-weight:750; letter-spacing:-.015em; }
.message { margin:0 0 16px; padding:11px 14px; font-size:13px; line-height:1.6; color:var(--text-2);
  background:var(--code-bg); border:1px solid var(--border); border-left:3px solid var(--danger);
  border-radius:10px; white-space:pre-wrap; word-break:break-word; }
.reqline { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:18px; }
.method { font-size:11px; font-weight:800; letter-spacing:.06em; padding:3px 9px; border-radius:7px;
  color:var(--accent); background:var(--accent-soft); border:1px solid var(--accent-ring); }
.url { font-size:13px; color:var(--text-2); word-break:break-all; }
.hero-actions { display:flex; flex-wrap:wrap; gap:8px; }

/* tabs */
.tabs { display:flex; gap:4px; margin:22px 0 18px; border-bottom:1px solid var(--border); overflow-x:auto; }
.tab { font:inherit; font-size:13px; font-weight:600; padding:10px 14px; background:none; border:0; cursor:pointer;
  color:var(--text-2); border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap; display:flex; gap:8px; align-items:center; }
.tab:hover { color:var(--text); }
.tab.active { color:var(--accent); border-bottom-color:var(--accent); }
.tab kbd { font:600 10px ui-monospace, monospace; color:var(--text-3); border:1px solid var(--border-strong);
  border-radius:5px; padding:0 5px; }
.count { font-size:11px; background:var(--accent-soft); color:var(--accent); border-radius:999px; padding:0 7px; }

/* overview grid */
.grid { display:grid; grid-template-columns:minmax(0,1fr) 290px; gap:18px; align-items:start; }
@media (max-width: 900px) { .grid { grid-template-columns:1fr; } .hero { padding:22px 18px; } h1 { font-size:23px; } }
.stack-col { display:flex; flex-direction:column; gap:18px; min-width:0; }

.card { background:var(--surface); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; }
.card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); }
.card-tools { display:flex; gap:8px; flex-wrap:wrap; }
h2 { margin:0; font-size:11.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-2); }
h3 { margin:0 0 8px; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-3); }
.muted { color:var(--text-3); font-size:13px; }

.callout { display:flex; gap:12px; padding:14px 16px; border-radius:14px; border:1px solid; line-height:1.6; }
.callout .ci { flex:none; margin-top:1px; }
.callout strong { display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; margin-bottom:2px; }
.callout.fix { background:var(--accent-soft); border-color:var(--accent-ring); }
.callout.fix .ci, .callout.fix strong { color:var(--accent); }
.callout.cause { background:var(--warn-soft); border-color:rgba(245,158,11,.35); }
.callout.cause .ci, .callout.cause strong { color:var(--warn); }

/* source */
.filebar { padding:8px 16px; font-size:12.5px; color:var(--text-2); background:var(--surface-2); border-bottom:1px solid var(--border); word-break:break-all; }
.filebar .dir { color:var(--text-3); } .filebar b { color:var(--text); font-weight:600; } .pos { color:var(--text-3); }
.code { background:var(--code-bg); padding:8px 0; overflow-x:auto; }
.cl { display:flex; font-family:ui-monospace,"JetBrains Mono",Consolas,monospace; font-size:13px; line-height:1.9; min-width:max-content; }
.cl-mark { flex:0 0 22px; text-align:center; color:var(--danger); font-weight:800; }
.cl-n { flex:0 0 44px; text-align:right; padding-right:16px; color:var(--text-3); user-select:none; }
.cl-t { white-space:pre; color:var(--text-2); padding-right:24px; }
.cl--hit { background:var(--danger-soft); box-shadow:inset 3px 0 0 var(--danger); }
.cl--hit .cl-n { color:var(--danger); font-weight:700; } .cl--hit .cl-t { color:var(--text); }

/* syntax */
.t-kw { color:var(--kw); font-weight:600; } .t-str { color:var(--str); } .t-num { color:var(--num); }
.t-com { color:var(--com); font-style:italic; } .t-fn { color:var(--fn); } .t-ph { color:var(--warn); } .t-id { color:var(--text); }
.t-culprit { color:var(--danger); background:var(--danger-soft); border-radius:4px; padding:0 4px; font-weight:700;
  box-shadow:inset 0 -2px 0 var(--danger-ring); }

/* sql */
.sql-grid { display:grid; gap:0; }
.sql-grid.has-params { grid-template-columns:minmax(0,1.8fr) minmax(210px,1fr); }
@media (max-width: 700px) { .sql-grid.has-params { grid-template-columns:1fr; } }
pre.sql { margin:0; padding:16px; font-size:13px; line-height:1.75; background:var(--code-bg); white-space:pre-wrap; word-break:break-word; overflow-x:auto; }
.params { padding:14px 16px; border-left:1px solid var(--border); background:var(--surface-2); }
@media (max-width: 700px) { .params { border-left:0; border-top:1px solid var(--border); } }
.param { display:flex; align-items:baseline; gap:10px; padding:5px 0; border-bottom:1px dashed var(--border); font-size:12.5px; }
.param:last-child { border-bottom:0; }
.pi { color:var(--text-3); width:16px; flex:none; } .pv { flex:1; word-break:break-all; }
.pt { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3); }

/* sidebar */
.glance { padding:14px 16px 8px; position:sticky; top:68px; }
.glance h2 { margin-bottom:8px; }
.g-row { display:flex; justify-content:space-between; gap:14px; padding:8px 0; border-top:1px solid var(--border); font-size:12.5px; }
.g-k { color:var(--text-3); flex:none; } .g-v { text-align:right; word-break:break-word; }
@media (max-width: 900px) { .glance { position:static; } }

/* stack */
.toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.switch { display:inline-flex; align-items:center; gap:10px; font-size:13px; color:var(--text-2); cursor:pointer; user-select:none; }
.switch input { position:absolute; opacity:0; pointer-events:none; }
.slider { width:34px; height:20px; border-radius:999px; background:var(--border-strong); position:relative; transition:background .15s; flex:none; }
.slider::after { content:""; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .15s; }
.switch input:checked + .slider { background:var(--accent); }
.switch input:checked + .slider::after { transform:translateX(14px); }
.switch input:focus-visible + .slider { outline:2px solid var(--accent-ring); outline-offset:2px; }
ol.frames { list-style:none; margin:0; padding:0; background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; box-shadow:var(--shadow); }
.frame { display:flex; align-items:center; gap:14px; padding:11px 16px; border-bottom:1px solid var(--border); }
.frame:last-child { border-bottom:0; }
.fi { flex:0 0 22px; color:var(--text-3); font-size:12px; text-align:right; }
.fmain { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.ffn { font-weight:600; font-size:13.5px; } .floc { font-size:12px; color:var(--text-2); word-break:break-all; }
.floc .dir { color:var(--text-3); } .floc b { color:var(--text); font-weight:600; }
.tag { flex:none; font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:2px 8px;
  border-radius:999px; color:var(--text-3); border:1px solid var(--border-strong); }
.tag-app { color:var(--accent); background:var(--accent-soft); border-color:var(--accent-ring); }
.frame.app { background:linear-gradient(90deg, var(--accent-soft), transparent 60%); }
.frame--first { background:linear-gradient(90deg, var(--danger-soft), transparent 70%); box-shadow:inset 3px 0 0 var(--danger); }
.frame.vendor, .frame.internal { opacity:.72; }
.frames:not(.show-all) .frame.vendor, .frames:not(.show-all) .frame.internal { display:none; }

/* request / raw */
.sections { display:grid; gap:18px; }
.section { padding:0; } .section .body { padding:6px 16px 14px; } 
.kv-row { display:flex; gap:20px; padding:9px 0; border-bottom:1px solid var(--border); font-size:12.5px; }
.kv-row:last-child { border-bottom:0; }
.kv-k { flex:0 0 190px; color:var(--text-3); word-break:break-word; } .kv-v { flex:1; word-break:break-all; }
@media (max-width: 700px) { .kv-row { flex-direction:column; gap:2px; } .kv-k { flex:none; } }
pre.raw { margin:0; padding:16px; font-size:12px; line-height:1.65; overflow:auto; max-height:70vh; background:var(--code-bg); }

.foot { margin-top:30px; text-align:center; font-size:12px; color:var(--text-3); line-height:1.8; }
.foot code { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:1px 6px; color:var(--text-2); }

#toast { position:fixed; left:50%; bottom:26px; transform:translate(-50%, 20px); opacity:0; pointer-events:none;
  background:var(--text); color:var(--bg); font-size:13px; font-weight:600; padding:9px 16px; border-radius:999px;
  transition:opacity .15s, transform .15s; z-index:50; }
#toast.show { opacity:1; transform:translate(-50%, 0); }
`

// ---------------------------------------------------------------
// Page
// ---------------------------------------------------------------
export function renderDebugPage(p) {
  const driverLabel = p.driver ? (DRIVER_LABELS[p.driver] ?? p.driver) : null
  const firstLine = String(p.message).split('\n')[0]
  const headline = p.title || firstLine
  const showMessage = p.title || String(p.message).includes('\n')
  const appFrames = p.frames.filter((f) => f.kind === 'app').length
  const driverSaid = p.cause && p.cause.message !== p.message

  const json = JSON.stringify(p).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.status)} · ${esc(headline)}</title>
<script>
  (function () {
    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) document.documentElement.classList.add("dark");
  })();
</script>
<style>${CSS}</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <div class="brand"><span class="logo">${ICONS.bolt}</span>Tylix <small>Debug</small></div>
  <div class="top-right">
    <span class="mono">Node ${esc(p.env.node)} · ${esc(p.env.nodeEnv)}</span>
    <button class="btn btn-icon" id="theme-toggle" title="Toggle theme (t)" aria-label="Toggle theme">${ICONS.sun}${ICONS.moon}</button>
  </div>
</div></div>

<div class="shell">
  <header class="hero">
    <div class="chips">
      <span class="chip danger">${esc(p.status)} ${esc(STATUS_TEXT[p.status] ?? '')}</span>
      <span class="chip">${esc(p.name)}</span>
      ${driverLabel ? `<span class="chip accent">${esc(driverLabel)}</span>` : ''}
      ${p.kind ? `<span class="chip">${esc(p.kind.replace(/_/g, ' '))}</span>` : ''}
      ${p.code ? `<span class="chip mono">${esc(p.code)}</span>` : ''}
    </div>
    <h1>${esc(headline)}</h1>
    ${showMessage ? `<p class="message mono">${esc(p.message)}</p>` : ''}
    <div class="reqline">
      <span class="method">${esc(p.request.method)}</span>
      <span class="url mono">${esc(p.request.url)}</span>
    </div>
    <div class="hero-actions">
      <button class="btn" data-copy="md">${ICONS.copy}<span>Copy as Markdown</span></button>
      <button class="btn" data-copy="json">${ICONS.copy}<span>Copy JSON</span></button>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab" data-tab="overview">Overview <kbd>1</kbd></button>
    <button class="tab" data-tab="stack">Stack trace <span class="count">${appFrames} yours</span> <kbd>2</kbd></button>
    <button class="tab" data-tab="request">Request <kbd>3</kbd></button>
    <button class="tab" data-tab="raw">Raw <kbd>4</kbd></button>
  </nav>

  <div class="panel" id="panel-overview">
    <div class="grid">
      <div class="stack-col">
        ${
          p.hint
            ? `<div class="callout fix"><span class="ci">${ICONS.bulb}</span><div><strong>How to fix</strong>${esc(p.hint)}</div></div>`
            : ''
        }
        ${
          driverSaid
            ? `<div class="callout cause"><span class="ci">${ICONS.alert}</span><div><strong>The driver said</strong><span class="mono">${esc(
                p.cause.name,
              )}${p.cause.code ? ` (${esc(p.cause.code)})` : ''}: ${esc(p.cause.message)}</span></div></div>`
            : ''
        }
        ${renderSource(p.source, p.env.cwd)}
        ${renderSql(p)}
        ${
          !p.hint && !p.source && !p.sql
            ? '<p class="muted">No extra details for this error. Open the Stack trace tab.</p>'
            : ''
        }
      </div>
      ${glance(p)}
    </div>
  </div>

  <div class="panel" id="panel-stack" hidden>${renderFrames(p.frames)}</div>

  <div class="panel" id="panel-request" hidden>
    <div class="sections">
      <section class="card section"><div class="card-head"><h2>Request</h2></div><div class="body">${kvRows({
        Method: p.request.method,
        URL: p.request.url,
        'Client IP': p.request.ip,
      })}</div></section>
      <section class="card section"><div class="card-head"><h2>Query string</h2></div><div class="body">${kvRows(
        p.request.query,
      )}</div></section>
      <section class="card section"><div class="card-head"><h2>Route params</h2></div><div class="body">${kvRows(
        p.request.params,
      )}</div></section>
      <section class="card section"><div class="card-head"><h2>Body</h2></div>${
        p.request.body
          ? `<pre class="raw mono">${esc(p.request.body)}</pre>`
          : '<div class="body"><p class="muted">Empty</p></div>'
      }</section>
      <section class="card section"><div class="card-head"><h2>Headers</h2></div><div class="body">${kvRows(
        p.request.headers,
      )}</div></section>
      <section class="card section"><div class="card-head"><h2>Environment</h2></div><div class="body">${kvRows({
        Node: p.env.node,
        Platform: p.env.platform,
        NODE_ENV: p.env.nodeEnv,
        'Working directory': p.env.cwd,
      })}</div></section>
    </div>
  </div>

  <div class="panel" id="panel-raw" hidden>
    <section class="card">
      <div class="card-head"><h2>Raw payload</h2>
        <div class="card-tools"><button class="btn btn-sm" data-copy="raw">${ICONS.copy}<span>Copy JSON</span></button></div></div>
      <pre class="raw mono">${esc(JSON.stringify(p, null, 2))}</pre>
    </section>
  </div>

  <footer class="foot">
    Debug mode is on. Set <code>APP_DEBUG=false</code> in production, because this page shows SQL, request data and source code.<br />
    Shortcuts: <code>1</code>–<code>4</code> switch tabs · <code>t</code> toggles theme
  </footer>
</div>

<div id="toast" role="status" aria-live="polite"></div>
<script id="debug-data" type="application/json">${json}</script>
<script>(${clientMain.toString()})()</script>
</body>
</html>`
}