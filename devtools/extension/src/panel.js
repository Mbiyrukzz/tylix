// The Tylix panel. Everything it knows comes from
// window.__TYLIX_DEVTOOLS_HOOK__ in the inspected page (installed by
// `tylix dev`), read with devtools.inspectedWindow.eval. The page is
// polled for the hook's `version`, and the tree and details are only
// re-read when it changes.
;(function () {
  const api = globalThis.browser ?? globalThis.chrome
  const POLL_MS = 600
  const HOOK = 'window.__TYLIX_DEVTOOLS_HOOK__'

  const $ = (id) => document.getElementById(id)
  const els = {
    status: $('status'),
    filter: $('filter'),
    refresh: $('refresh'),
    instances: $('instances'),
    capabilities: $('capabilities'),
    details: $('details'),
    nohook: $('nohook'),
  }

  let snapshot = null
  let selected = null // instance id or 'cap:Name'
  let lastVersion = -2
  let editing = null // key being edited in the details pane

  if (api.devtools.panels.themeName === 'dark') document.documentElement.classList.add('dark')

  // ------------------------------------------------------------ page I/O

  function evalInPage(expression) {
    return new Promise((resolve) => {
      api.devtools.inspectedWindow.eval(expression, (result, exception) => {
        if (exception) resolve({ error: exception.value ?? exception.description ?? 'eval failed' })
        else resolve({ result })
      })
    })
  }

  // Calls hook.method(...args) in the page; args are passed as JSON.
  function hookCall(method, ...args) {
    const list = args.map((a) => JSON.stringify(a)).join(', ')
    return evalInPage(`(function (h) { return h ? h.${method}(${list}) : null })(${HOOK})`)
  }

  // ------------------------------------------------------------- polling

  async function poll() {
    const { result, error } = await evalInPage(`(function (h) { return h ? h.version : -1 })(${HOOK})`)
    if (error) {
      setStatus(`Cannot reach the page: ${error}`, true)
    } else if (result === -1) {
      showNoHook(true)
      lastVersion = -1
    } else {
      showNoHook(false)
      if (result !== lastVersion) {
        lastVersion = result
        await refresh()
      }
    }
    setTimeout(poll, POLL_MS)
  }

  async function refresh() {
    const { result } = await hookCall('snapshot')
    if (!result) return
    snapshot = result
    // snapshot() may itself start watchers and bump the version
    lastVersion = result.version
    renderTree()
    if (selected !== null) await renderDetails()
    const count = snapshot.instances.length
    setStatus(`${count} instance${count === 1 ? '' : 's'} · ${snapshot.capabilities.length} capabilities · ${snapshot.url}`)
  }

  function setStatus(text, isError = false) {
    els.status.textContent = text
    els.status.classList.toggle('error', isError)
  }

  function showNoHook(on) {
    els.nohook.hidden = !on
    if (on) setStatus('No Tylix devtools hook on this page')
  }

  // ---------------------------------------------------------------- tree

  function renderTree() {
    const filter = els.filter.value.trim().toLowerCase()
    const byParent = new Map()
    for (const item of snapshot.instances) {
      const key = item.parentId ?? 'root'
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(item)
    }
    const order = { layout: 0, page: 1, component: 2, loading: 3 }
    const roots = (byParent.get('root') ?? []).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))

    const matches = (item) =>
      !filter ||
      item.name.toLowerCase().includes(filter) ||
      (byParent.get(item.id) ?? []).some(matches)

    els.instances.replaceChildren()
    const build = (items, depth, into) => {
      for (const item of items) {
        if (!matches(item)) continue
        into.append(treeRow(item.id, item.name, item.kind === 'component' ? null : item.kind, depth))
        build(byParent.get(item.id) ?? [], depth + 1, into)
      }
    }
    build(roots, 0, els.instances)
    if (!els.instances.children.length) els.instances.append(noneRow(filter ? 'No match' : 'None yet'))

    els.capabilities.replaceChildren()
    for (const cap of snapshot.capabilities) {
      if (filter && !cap.name.toLowerCase().includes(filter)) continue
      els.capabilities.append(treeRow(cap.id, cap.name, null, 0))
    }
    if (!els.capabilities.children.length) els.capabilities.append(noneRow('None used on this page'))
  }

  function treeRow(id, name, kind, depth) {
    const li = document.createElement('li')
    li.setAttribute('role', 'treeitem')
    const row = document.createElement('div')
    row.className = 'row' + (id === selected ? ' selected' : '')
    row.style.paddingLeft = `${10 + depth * 14}px`
    row.tabIndex = 0
    const nameEl = document.createElement('span')
    nameEl.className = 'name'
    nameEl.textContent = kind === null && typeof id === 'number' ? `<${name}>` : name
    row.append(nameEl)
    if (kind) {
      const k = document.createElement('span')
      k.className = 'kind'
      k.textContent = kind
      row.append(k)
    }
    row.addEventListener('click', () => select(id))
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') select(id)
    })
    if (typeof id === 'number') {
      row.addEventListener('mouseenter', () => hookCall('highlight', id))
      row.addEventListener('mouseleave', () => hookCall('highlight', null))
    }
    li.append(row)
    return li
  }

  function noneRow(text) {
    const li = document.createElement('li')
    li.className = 'none'
    li.textContent = text
    return li
  }

  async function select(id) {
    selected = id
    editing = null
    renderTree()
    await renderDetails()
  }

  // ------------------------------------------------------------- details

  async function renderDetails() {
    // Don't yank an editor out from under the user.
    if (editing !== null && els.details.contains(document.activeElement)) return
    const { result } = await hookCall('inspect', selected)
    if (!result) {
      els.details.replaceChildren(para('This instance is gone (it unmounted). Pick another.', 'empty'))
      return
    }
    const header = document.createElement('header')
    const h1 = document.createElement('h1')
    h1.textContent = result.name
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = result.kind
    header.append(h1, badge)

    const parts = [header]
    parts.push(...fieldSection('State', result.state))
    if (result.props.length) parts.push(...fieldSection('Props', result.props))
    if (result.computed.length) parts.push(...fieldSection('Computed', result.computed))
    if (result.actions.length) parts.push(...actionSection(result.actions))
    els.details.replaceChildren(...parts)
  }

  function fieldSection(title, fields) {
    const h2 = document.createElement('h2')
    h2.textContent = title
    const ul = document.createElement('ul')
    ul.className = 'fields'
    if (!fields.length) ul.append(para('none', 'empty'))
    for (const f of fields) ul.append(fieldRow(f))
    return [h2, ul]
  }

  function fieldRow(f) {
    const li = document.createElement('li')
    const head = document.createElement('div')
    head.className = 'field-head'
    const key = document.createElement('span')
    key.className = 'key'
    key.textContent = `${f.key}:`
    const value = document.createElement('span')
    value.className = 'value'
    value.append(renderValue(f.preview))
    head.append(key, value)
    if (f.editable) {
      const edit = document.createElement('button')
      edit.className = 'edit'
      edit.type = 'button'
      edit.textContent = 'edit'
      edit.addEventListener('click', () => openEditor(li, f))
      head.append(edit)
    }
    li.append(head)
    return li
  }

  function openEditor(li, f) {
    editing = f.key
    const box = document.createElement('div')
    box.className = 'editor'
    const area = document.createElement('textarea')
    area.value = f.json ?? ''
    area.spellcheck = false
    area.setAttribute('aria-label', `New JSON value for ${f.key}`)
    const actions = document.createElement('div')
    actions.className = 'actions'
    const save = document.createElement('button')
    save.className = 'primary'
    save.type = 'button'
    save.textContent = 'Save'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    const err = document.createElement('span')
    err.className = 'error'
    actions.append(save, cancel, err)
    box.append(area, actions)
    li.append(box)
    area.focus()

    const close = () => {
      editing = null
      box.remove()
      renderDetails()
    }
    save.addEventListener('click', async () => {
      const { result, error } = await hookCall('set', selected, f.key, area.value)
      if (error || !result?.ok) {
        err.textContent = error ?? result?.error ?? 'Could not set the value'
        return
      }
      close()
    })
    cancel.addEventListener('click', close)
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click()
      if (e.key === 'Escape') cancel.click()
    })
  }

  function actionSection(actions) {
    const h2 = document.createElement('h2')
    h2.textContent = 'Actions'
    const ul = document.createElement('ul')
    ul.className = 'fields'
    for (const name of actions) {
      const li = document.createElement('li')
      li.className = 'action-row'
      const key = document.createElement('span')
      key.className = 'key'
      key.textContent = `${name}(`
      const args = document.createElement('input')
      args.placeholder = 'args as JSON, e.g. 1, "a"'
      args.setAttribute('aria-label', `Arguments for ${name}`)
      const close = document.createElement('span')
      close.className = 'key'
      close.textContent = ')'
      const run = document.createElement('button')
      run.type = 'button'
      run.textContent = 'Run'
      const out = document.createElement('span')
      out.className = 'result'
      run.addEventListener('click', async () => {
        const { result, error } = await hookCall('call', selected, name, args.value)
        out.className = error || !result?.ok ? 'error' : 'result'
        out.replaceChildren()
        if (error || !result?.ok) out.textContent = error ?? result?.error
        else if (typeof result.result === 'string') out.textContent = result.result
        else out.append('→ ', renderValue(result.result))
      })
      args.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') run.click()
      })
      li.append(key, args, close, run, out)
      ul.append(li)
    }
    return [h2, ul]
  }

  function para(text, cls) {
    const p = document.createElement('p')
    if (cls) p.className = cls
    p.textContent = text
    return p
  }

  // Renders a hook preview ({ t, v, n, items, entries }) as DOM.
  function renderValue(p) {
    const span = (cls, text) => {
      const s = document.createElement('span')
      s.className = cls
      s.textContent = text
      return s
    }
    switch (p?.t) {
      case 'string': return span('s', JSON.stringify(p.v))
      case 'number': case 'bigint': return span('n', String(p.v) + (p.t === 'bigint' ? 'n' : ''))
      case 'boolean': case 'null': case 'undefined': return span('k', p.t === 'boolean' ? String(p.v) : p.t)
      case 'date': return span('s', `Date(${p.v})`)
      case 'function': return span('m', `ƒ ${p.v}()`)
      case 'node': return span('m', `<${p.v}>`)
      case 'promise': return span('m', 'Promise')
      case 'symbol': return span('m', p.v)
      case 'array': case 'set': case 'map': case 'object': {
        const label = p.t === 'object' ? `{…} ${p.n} key${p.n === 1 ? '' : 's'}` : `${p.t === 'array' ? 'Array' : p.t === 'set' ? 'Set' : 'Map'}(${p.n})`
        if (p.more) return span('m', label)
        if (!p.n) return span('m', p.t === 'object' ? '{}' : p.t === 'array' ? '[]' : label)
        const details = document.createElement('details')
        const summary = document.createElement('summary')
        summary.append(span('m', label))
        const list = document.createElement('ul')
        list.className = 'children'
        const rows = p.items ? p.items.map((v, i) => [p.t === 'set' ? '•' : String(i), v]) : p.entries
        for (const [k, v] of rows) {
          const li = document.createElement('li')
          li.append(span('key', `${k}: `), renderValue(v))
          list.append(li)
        }
        if (p.n > rows.length) list.append(span('m', `… ${p.n - rows.length} more`))
        details.append(summary, list)
        return details
      }
      default: return span('m', '?')
    }
  }

  // ------------------------------------------------------------- startup

  els.filter.addEventListener('input', () => snapshot && renderTree())
  els.refresh.addEventListener('click', () => {
    lastVersion = -2
    refresh()
  })
  api.devtools.network?.onNavigated?.addListener(() => {
    selected = null
    lastVersion = -2
    els.details.replaceChildren(para('Select a component or capability to see its state.', 'empty'))
  })
  poll()
})()
