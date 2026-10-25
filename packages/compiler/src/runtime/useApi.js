export async function useApi(url, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    credentials = 'include',
  } = options

  const finalHeaders = { ...headers }
  let finalBody = body
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] =
      finalHeaders['Content-Type'] || 'application/json'
    finalBody = JSON.stringify(body)
  }

  // __tylixRequestStart/End are injected by the runtime. Guarding them
  // lets this exact file work whether or not they exist.
  const track = typeof __tylixRequestStart === 'function'
  if (track) __tylixRequestStart()

  try {
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: finalBody,
      credentials,
    })
    let data = null
    try {
      data = await response.json()
    } catch {
      /* empty body */
    }
    if (!response.ok) {
      // Only present when the server runs with APP_DEBUG=true.
      const debug =
        data && typeof data === 'object' && data.debug ? data.debug : null
      if (debug) showDebug(debug, method, url)
      return {
        ok: false,
        status: response.status,
        data,
        error: (data && (data.error || data.message)) || 'Request failed',
        debug,
      }
    }
    return { ok: true, status: response.status, data, error: null, debug: null }
  } catch (err) {
    console.warn(
      `[tylix] ${method} ${url} could not reach the server: ${err.message}. ` +
        'Is "tylix dev" running, and is the URL correct?',
    )
    return { ok: false, status: 0, data: null, error: err.message, debug: null }
  } finally {
    if (track) __tylixRequestEnd()
  }

  // ---------------------------------------------------------------
  // Dev debug UI. Everything lives inside useApi on purpose, so the
  // file still works if the compiler injects only this one function.
  // ---------------------------------------------------------------
  function showDebug(debug, method, url) {
    logToConsole(debug, method, url)
    try {
      showOverlay(debug, method, url)
    } catch (err) {
      console.warn('[tylix] debug overlay failed:', err)
    }
  }

  function logToConsole(d, method, url) {
    console.groupCollapsed(
      `%c${d.status} %c${method} ${url} %c${d.title || d.message}`,
      'color:#fb7185;font-weight:bold',
      'color:inherit',
      'color:#fb7185',
    )
    if (d.hint) console.log('How to fix:', d.hint)
    console.log('Message:', d.message)
    if (d.sql) console.log('SQL:', d.sql, d.params?.length ? d.params : '')
    if (d.source) console.log('Source:', `${d.source.file}:${d.source.line}`)
    const mine = (d.frames || []).filter((f) => f.kind === 'app')
    if (mine.length) {
      console.log(
        'Your frames:\n' +
          mine.map((f) => `  ${f.fn || '<anonymous>'} (${f.short}:${f.line})`).join('\n'),
      )
    }
    console.log('Full payload:', d)
    console.groupEnd()
  }

  function showOverlay(debug, method, url) {
    if (typeof document === 'undefined') return

    const store = (window.__tylixDebug = window.__tylixDebug || {
      errors: [],
      index: 0,
      open: false,
    })
    store.errors.unshift({ debug, method, url })
    store.errors = store.errors.slice(0, 20)
    store.index = 0
    render()

    function h(tag, props, ...children) {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(props || {})) {
        if (key === 'class') node.className = value
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
        else if (value != null) node.setAttribute(key, value)
      }
      for (const child of children.flat()) {
        if (child == null || child === false) continue
        node.append(child.nodeType ? child : document.createTextNode(String(child)))
      }
      return node
    }

    function getRoot() {
      let host = document.getElementById('__tylix-debug-host')
      if (!host) {
        host = document.createElement('div')
        host.id = '__tylix-debug-host'
        document.body.appendChild(host)
        host.attachShadow({ mode: 'open' })
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && store.open) {
            store.open = false
            render()
          }
        })
      }
      return host.shadowRoot
    }

    const KEYWORDS = new Set(
      (
        'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER ADD DROP COLUMN ' +
        'INDEX UNIQUE PRIMARY KEY JOIN LEFT RIGHT INNER ON AS AND OR NOT NULL IN IS LIKE ORDER BY ' +
        'GROUP HAVING LIMIT OFFSET ASC DESC COUNT RETURNING IF EXISTS DEFAULT'
      ).split(' '),
    )

    function highlightSql(sql, culprits) {
      const re =
        /('(?:[^'\\]|\\.)*')|(`[^`]*`|"[^"]*")|(\?|\$\d+)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)/g
      const out = []
      let last = 0
      let m
      while ((m = re.exec(sql))) {
        if (m.index > last) out.push(sql.slice(last, m.index))
        const token = m[0]
        let cls = null
        if (m[1]) cls = 'str'
        else if (m[2]) cls = culprits.has(token.slice(1, -1)) ? 'culprit' : 'id'
        else if (m[3]) cls = 'ph'
        else if (m[4]) cls = 'num'
        else if (KEYWORDS.has(token.toUpperCase())) cls = 'kw'
        else if (culprits.has(token)) cls = 'culprit'
        out.push(cls ? h('span', { class: 't-' + cls }, token) : token)
        last = re.lastIndex
      }
      if (last < sql.length) out.push(sql.slice(last))
      return out
    }

    function copy(button, text) {
      const done = () => {
        const old = button.textContent
        button.textContent = 'Copied'
        setTimeout(() => (button.textContent = old), 1400)
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, done)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        try {
          document.execCommand('copy')
        } catch {
          /* ignore */
        }
        ta.remove()
        done()
      }
    }

    function toMarkdown(d, method, url) {
      const fence = String.fromCharCode(96).repeat(3)
      const lines = [`## ${d.title || d.name}`, '', `**${d.name}${d.driver ? ` (${d.driver})` : ''}:** ${d.message}`]
      if (d.hint) lines.push('', `**Hint:** ${d.hint}`)
      if (d.sql) {
        lines.push('', fence + 'sql', d.sql, fence)
        if (d.params?.length) lines.push('Params: ' + JSON.stringify(d.params))
      }
      lines.push('', `**Request:** ${method} ${url}`)
      const mine = (d.frames || []).filter((f) => f.kind === 'app').slice(0, 8)
      if (mine.length) {
        lines.push('', fence)
        for (const f of mine) lines.push(`at ${f.fn || '<anonymous>'} (${f.short}:${f.line}:${f.column})`)
        lines.push(fence)
      }
      return lines.join('\n')
    }

    function panel(entry) {
      const { debug: d, method, url } = entry
      const culprits = new Set([d.table, d.column].filter(Boolean))
      const mine = (d.frames || []).filter((f) => f.kind === 'app').slice(0, 6)

      return h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'chips' },
          h('span', { class: 'chip danger' }, d.status),
          d.driver && h('span', { class: 'chip accent' }, d.driver),
          d.kind && h('span', { class: 'chip' }, d.kind.replace(/_/g, ' ')),
          d.code && h('span', { class: 'chip mono' }, d.code),
        ),
        h('h1', {}, d.title || String(d.message).split('\n')[0]),
        h('p', { class: 'req mono' }, `${method} ${url}`),
        d.title && h('pre', { class: 'message mono' }, d.message),
        d.hint &&
          h('div', { class: 'hint' }, h('b', {}, 'How to fix'), h('span', {}, d.hint)),
        d.source &&
          h(
            'section',
            {},
            h('h2', {}, `Where it happened  ${d.source.file}:${d.source.line}`),
            h(
              'div',
              { class: 'code' },
              d.source.lines.map((text, i) => {
                const n = d.source.start + i
                return h(
                  'div',
                  { class: 'line' + (n === d.source.line ? ' hit' : '') },
                  h('span', { class: 'gutter' }, n),
                  h('span', { class: 'mono' }, text || ' '),
                )
              }),
            ),
          ),
        d.sql &&
          h(
            'section',
            {},
            h('h2', {}, d.driver === 'mongodb' ? 'Operation' : 'Query'),
            h('pre', { class: 'sql mono' }, highlightSql(d.sql, culprits)),
            d.params?.length > 0 &&
              h(
                'div',
                { class: 'params mono' },
                d.params.map((v, i) => h('div', {}, `${i + 1}  ${JSON.stringify(v)}`)),
              ),
          ),
        mine.length > 0 &&
          h(
            'section',
            {},
            h('h2', {}, 'Your code in the stack'),
            mine.map((f) =>
              h(
                'div',
                { class: 'frame' },
                h('b', {}, f.fn || '<anonymous>'),
                h('span', { class: 'mono' }, `${f.short}:${f.line}:${f.column}`),
              ),
            ),
          ),
        h(
          'div',
          { class: 'actions' },
          h('button', { onclick: (e) => copy(e.target, toMarkdown(d, method, url)) }, 'Copy as Markdown'),
          h('button', { onclick: (e) => copy(e.target, JSON.stringify(d, null, 2)) }, 'Copy JSON'),
        ),
      )
    }

    function render() {
      const root = getRoot()
      const dark =
        document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches
      const entry = store.errors[store.index]
      const total = store.errors.length

      const nodes = [h('style', {}, CSS)]

      if (total === 0) {
        root.replaceChildren(...nodes)
        return
      }

      if (!store.open) {
        nodes.push(
          h(
            'button',
            {
              class: 'badge' + (dark ? ' dark' : ''),
              onclick: () => {
                store.open = true
                render()
              },
            },
            h('span', { class: 'dot' }),
            `${entry.debug.status} ${entry.debug.title || entry.debug.message}`.slice(0, 70),
            total > 1 && h('span', { class: 'count' }, `+${total - 1}`),
          ),
        )
      } else {
        const close = () => {
          store.open = false
          render()
        }
        nodes.push(
          h(
            'div',
            { class: 'backdrop' + (dark ? ' dark' : ''), onclick: (e) => e.target === e.currentTarget && close() },
            h(
              'div',
              { class: 'modal' },
              h(
                'div',
                { class: 'bar' },
                h('span', {}, 'Tylix debug'),
                total > 1 &&
                  h(
                    'span',
                    { class: 'pager' },
                    h('button', { onclick: () => { store.index = Math.min(total - 1, store.index + 1); render() } }, '‹'),
                    `${store.index + 1} / ${total}`,
                    h('button', { onclick: () => { store.index = Math.max(0, store.index - 1); render() } }, '›'),
                  ),
                h(
                  'span',
                  { class: 'bar-actions' },
                  h('button', { onclick: () => { store.errors = []; store.open = false; render() } }, 'Dismiss all'),
                  h('button', { onclick: close }, 'Close (Esc)'),
                ),
              ),
              panel(entry),
            ),
          ),
        )
      }
      root.replaceChildren(...nodes)
    }

    const CSS = `
      * { box-sizing: border-box; }
      .mono, pre { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
      .dark, .backdrop, .badge { --bg:#fff; --bg2:#f1f5f9; --bd:#cbd5e1; --tx:#1e293b; --tx2:#64748b; --ac:#047857; --acbg:rgba(16,185,129,.1);
        --dg:#be123c; --dgbg:#ffe4e6; --kw:#7c3aed; --st:#047857; --nu:#b45309; }
      .dark { --bg:#0f172a; --bg2:#0b1220; --bd:#334155; --tx:#e2e8f0; --tx2:#94a3b8; --ac:#10b981; --acbg:rgba(16,185,129,.12);
        --dg:#fb7185; --dgbg:rgba(76,5,25,.4); --kw:#a78bfa; --st:#34d399; --nu:#fbbf24; }
      button { font: inherit; cursor: pointer; }
      .badge { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 8px; align-items: center;
        max-width: min(520px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 999px; font: 600 13px system-ui, sans-serif;
        background: var(--bg); color: var(--tx); border: 1px solid var(--dg); box-shadow: 0 8px 30px rgba(0,0,0,.25); }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dg); flex: none; }
      .count { background: var(--dgbg); color: var(--dg); border-radius: 999px; padding: 1px 8px; font-size: 12px; }
      .backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(2,6,23,.6); display: flex;
        align-items: flex-start; justify-content: center; padding: 4vh 16px; overflow-y: auto; font: 14px/1.55 system-ui, sans-serif; color: var(--tx); }
      .modal { width: 100%; max-width: 880px; background: var(--bg); border: 1px solid var(--bd); border-radius: 16px; overflow: hidden; }
      .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px;
        border-bottom: 1px solid var(--bd); font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--tx2); }
      .bar button, .actions button { background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 999px; padding: 4px 12px; font-size: 12px; }
      .bar button:hover, .actions button:hover { border-color: var(--ac); }
      .bar-actions, .pager { display: flex; gap: 8px; align-items: center; }
      .panel { padding: 22px 26px 26px; }
      .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
      .chip { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 10px;
        border-radius: 999px; border: 1px solid var(--bd); color: var(--tx2); }
      .chip.danger { color: var(--dg); background: var(--dgbg); border-color: var(--dg); }
      .chip.accent { color: var(--ac); background: var(--acbg); border-color: var(--ac); }
      h1 { font-size: 22px; line-height: 1.3; margin: 0 0 6px; }
      h2 { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--tx2); margin: 22px 0 8px; }
      .req { color: var(--tx2); font-size: 12.5px; margin: 0 0 12px; }
      .message { background: var(--bg2); border: 1px solid var(--bd); border-left: 3px solid var(--dg); border-radius: 8px;
        padding: 10px 14px; margin: 0 0 14px; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
      .hint { display: flex; flex-direction: column; gap: 2px; background: var(--acbg); border: 1px solid var(--ac); border-radius: 10px; padding: 12px 16px; }
      .hint b { color: var(--ac); font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; }
      .code { background: var(--bg2); border: 1px solid var(--bd); border-radius: 10px; padding: 6px 0; overflow-x: auto; }
      .line { display: flex; font-size: 13px; line-height: 1.85; white-space: pre; }
      .gutter { flex: 0 0 52px; text-align: right; padding-right: 14px; color: var(--tx2); user-select: none; }
      .line.hit { background: var(--dgbg); } .line.hit .gutter { color: var(--dg); font-weight: 700; }
      .sql { margin: 0; background: var(--bg2); border: 1px solid var(--bd); border-radius: 10px; padding: 12px 16px;
        font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
      .t-kw { color: var(--kw); font-weight: 600; } .t-str { color: var(--st); } .t-num { color: var(--nu); } .t-ph { color: var(--nu); }
      .t-culprit { color: var(--dg); background: var(--dgbg); border-radius: 4px; padding: 0 3px; font-weight: 700; }
      .params { margin-top: 8px; font-size: 12.5px; color: var(--tx2); background: var(--bg2); border: 1px solid var(--bd);
        border-radius: 10px; padding: 10px 14px; word-break: break-all; }
      .frame { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 7px 0; border-bottom: 1px solid var(--bd); font-size: 13px; }
      .frame span { color: var(--ac); font-size: 12px; word-break: break-all; }
      .actions { display: flex; gap: 8px; margin-top: 22px; }
    `
  }
}