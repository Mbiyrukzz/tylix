// Tylix devtools hook: a plain browser script (no imports or exports).
//
// Installs window.__TYLIX_DEVTOOLS_HOOK__, which the native runtime
// reports to as it creates page, layout and component instances and
// resolves capabilities. `tylix dev` injects it into every page, and
// the Tylix DevTools browser extension installs it before any page
// script runs, so it also works on apps not served by `tylix dev`.
// Without it, the runtime's only cost is one property check per
// instance.
//
// Everything the hook hands out is plain JSON, so the extension can
// fetch it with devtools.inspectedWindow.eval:
//   hook.snapshot()           tree of live instances + capabilities
//   hook.inspect(id)          state / props / computed / actions of one
//   hook.set(id, key, json)   assign a state field or prop (re-renders)
//   hook.call(id, action, argsJson)
//   hook.highlight(id) / hook.highlight(null)
//   hook.version              bumps whenever anything watched changes
// From the console: __TYLIX_DEVTOOLS_HOOK__.find("Counter")
;(function () {
  if (typeof window === 'undefined' || window.__TYLIX_DEVTOOLS_HOOK__) return

  var nextId = 1
  var records = new Map() // id -> { id, kind, name, instance, node, watcher }
  var byInstance = new WeakMap() // instance -> record
  var capabilities = new Map() // name -> { id, name, instance, watcher }
  var runtime = null // { effect, untracked, toRaw } from the page
  var watching = false
  var overlay = null

  var hook = {
    version: 0,
    apiVersion: 1,

    // Called by the runtime (see __tylixExpose).
    register: function (instance, meta, rt) {
      if (!instance || byInstance.has(instance)) return
      if (rt) runtime = rt
      var rec = {
        id: nextId++,
        kind: (meta && meta.kind) || 'component',
        name: (meta && meta.name) || 'Anonymous',
        instance: instance,
        node: null,
        watcher: null,
      }
      records.set(rec.id, rec)
      byInstance.set(instance, rec)
      if (watching) watch(rec)
      bump()
    },

    attach: function (instance, node) {
      var rec = byInstance.get(instance)
      if (rec) {
        rec.node = node
        bump()
      }
    },

    capability: function (name, instance) {
      if (capabilities.has(name)) return
      var rec = { id: 'cap:' + name, name: name, instance: instance, watcher: null }
      capabilities.set(name, rec)
      if (watching) watch(rec)
      bump()
    },

    snapshot: function () {
      startWatching()
      prune()
      var live = []
      records.forEach(function (rec) {
        live.push(rec)
      })
      var items = live.map(function (rec) {
        return {
          id: rec.id,
          kind: rec.kind,
          name: rec.name,
          parentId: parentOf(rec, live),
          tag: rec.node && rec.node.tagName ? rec.node.tagName.toLowerCase() : null,
        }
      })
      var caps = []
      capabilities.forEach(function (rec) {
        caps.push({ id: rec.id, name: rec.name })
      })
      return { version: hook.version, instances: items, capabilities: caps, url: location.href }
    },

    inspect: function (id) {
      var rec = lookup(id)
      if (!rec) return null
      var inst = rec.instance
      var out = { id: id, name: rec.name, kind: rec.kind || 'capability', state: [], props: [], computed: [], actions: [] }
      var seen = {}

      if (rec.kind) {
        // page / layout / component: generated class instance
        var state = inst.__state ? keysOf(inst.__state) : []
        state.forEach(function (k) {
          seen[k] = true
          out.state.push(field(inst, k, true))
        })
        var props = inst.__props ? keysOf(inst.__props) : []
        props.forEach(function (k) {
          if (seen[k]) return
          seen[k] = true
          out.props.push(field(inst, k, true))
        })
        var proto = Object.getPrototypeOf(inst)
        Object.getOwnPropertyNames(proto).forEach(function (k) {
          if (k === 'constructor' || k.indexOf('__') === 0 || seen[k]) return
          var d = Object.getOwnPropertyDescriptor(proto, k)
          if (d.get) out.computed.push(field(inst, k, false))
          else if (typeof d.value === 'function') out.actions.push(k)
        })
      } else {
        // capability: a reactive object of state plus bound actions
        keysOf(inst).forEach(function (k) {
          if (k === 'ready') return
          var v = safeGet(inst, k)
          if (typeof v.value === 'function') out.actions.push(k)
          else out.state.push(field(inst, k, true))
        })
      }
      return out
    },

    set: function (id, key, json) {
      var rec = lookup(id)
      if (!rec) return { ok: false, error: 'Not found (the component may have unmounted).' }
      var value
      try {
        value = JSON.parse(json)
      } catch (e) {
        return { ok: false, error: 'Not valid JSON: ' + e.message }
      }
      try {
        rec.instance[key] = value
        bump()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    call: function (id, action, argsJson) {
      var rec = lookup(id)
      if (!rec) return { ok: false, error: 'Not found.' }
      var args = []
      try {
        if (argsJson && argsJson.trim()) args = JSON.parse('[' + argsJson + ']')
      } catch (e) {
        return { ok: false, error: 'Arguments must be comma-separated JSON: ' + e.message }
      }
      try {
        var result = rec.instance[action].apply(rec.instance, args)
        if (result && typeof result.then === 'function') {
          result.then(
            function (v) { console.log('[tylix devtools] ' + rec.name + '.' + action + '() resolved:', v) },
            function (err) { console.error('[tylix devtools] ' + rec.name + '.' + action + '() rejected:', err) },
          )
          return { ok: true, result: '(promise, see the console)' }
        }
        return { ok: true, result: preview(result, 2) }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    highlight: function (id) {
      var rec = id == null ? null : records.get(id)
      var node = rec && rec.node
      if (!node || !node.getBoundingClientRect || !node.isConnected) {
        if (overlay) overlay.style.display = 'none'
        return false
      }
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.setAttribute('data-tylix-devtools', '')
        overlay.style.cssText =
          'position:fixed;pointer-events:none;z-index:2147483646;background:rgba(16,185,129,.15);' +
          'border:2px solid #10b981;border-radius:4px;transition:all .08s ease;font:11px/1.6 ui-monospace,monospace'
        var label = document.createElement('span')
        label.style.cssText = 'position:absolute;top:-20px;left:-2px;background:#10b981;color:#022c22;padding:0 6px;border-radius:3px;white-space:nowrap'
        overlay.appendChild(label)
        document.documentElement.appendChild(overlay)
      }
      var r = node.getBoundingClientRect()
      overlay.style.display = ''
      overlay.style.left = r.left + 'px'
      overlay.style.top = r.top + 'px'
      overlay.style.width = r.width + 'px'
      overlay.style.height = r.height + 'px'
      overlay.firstChild.textContent = '<' + rec.name + '> ' + Math.round(r.width) + '×' + Math.round(r.height)
      node.scrollIntoView({ block: 'nearest' })
      return true
    },

    // Console helper: the live instances named `name`.
    find: function (name) {
      var out = []
      records.forEach(function (rec) {
        if (rec.name === name) out.push(rec.instance)
      })
      capabilities.forEach(function (rec) {
        if (rec.name === name) out.push(rec.instance)
      })
      return out
    },
  }

  function bump() {
    hook.version++
  }

  function lookup(id) {
    if (typeof id === 'string' && id.indexOf('cap:') === 0) return capabilities.get(id.slice(4)) || null
    return records.get(id) || null
  }

  // Watching starts the first time a snapshot is asked for, so a page
  // that nobody inspects never pays for it.
  function startWatching() {
    if (watching || !runtime) return
    watching = true
    records.forEach(watch)
    capabilities.forEach(watch)
  }

  // Re-reads everything the instance holds (deeply, so nested edits
  // count) inside an effect; any change bumps the version.
  function watch(rec) {
    if (!runtime || rec.watcher) return
    var first = true
    rec.watcher = runtime.untracked(function () {
      return runtime.effect(function () {
        try {
          touch(rec.instance.__state || rec.instance, 0)
          if (rec.instance.__propOverrides) touch(rec.instance.__propOverrides, 0)
        } catch (e) {}
        if (!first) bump()
        first = false
      })
    })
  }

  function touch(value, depth) {
    if (value === null || typeof value !== 'object' || depth > 6) return
    if (typeof Node !== 'undefined' && value instanceof Node) return
    if (value instanceof Map || value instanceof Set) {
      value.forEach(function (v) {
        touch(v, depth + 1)
      })
      return
    }
    for (var k in value) touch(value[k], depth + 1)
  }

  // Unmounted components (their node left the document) and the
  // loading page, once the real page is up, are dropped.
  function prune() {
    records.forEach(function (rec, id) {
      var gone =
        (rec.kind === 'component' && rec.node && !rec.node.isConnected) ||
        (rec.kind === 'loading' && (!rec.node || !rec.node.isConnected))
      if (gone) {
        if (rec.watcher) rec.watcher.active = false
        records.delete(id)
      }
    })
  }

  // The closest live instance whose node contains this one's.
  function parentOf(rec, live) {
    if (rec.kind === 'page' || rec.kind === 'layout') return null
    var best = null
    if (rec.node) {
      for (var i = 0; i < live.length; i++) {
        var other = live[i]
        if (other === rec || !other.node || other.node === rec.node) continue
        if (other.node.contains && other.node.contains(rec.node)) {
          if (!best || best.node.contains(other.node)) best = other
        }
      }
    }
    if (best) return best.id
    // Not inside another component: under the page.
    for (var j = 0; j < live.length; j++) if (live[j].kind === 'page') return live[j].id
    return null
  }

  function keysOf(obj) {
    try {
      return Object.keys(runtime && runtime.toRaw ? runtime.toRaw(obj) : obj)
    } catch (e) {
      return []
    }
  }

  function safeGet(obj, key) {
    try {
      return { value: obj[key] }
    } catch (e) {
      return { error: String((e && e.message) || e) }
    }
  }

  function field(inst, key, editable) {
    var got = safeGet(inst, key)
    var f = { key: key, editable: editable }
    if ('error' in got) {
      f.preview = '⚠ ' + got.error
      f.editable = false
    } else {
      f.preview = preview(got.value, 4)
      f.json = toJson(got.value)
      if (f.json === undefined) f.editable = false
    }
    return f
  }

  function toJson(value) {
    try {
      var seen = new WeakSet()
      return JSON.stringify(value, function (k, v) {
        if (typeof v === 'function') return undefined
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
        }
        return v
      }, 2)
    } catch (e) {
      return undefined
    }
  }

  // A JSON-safe, size-limited picture of a value for display.
  function preview(value, depth) {
    if (value === undefined) return { t: 'undefined' }
    if (value === null) return { t: 'null' }
    var type = typeof value
    if (type === 'string') return { t: 'string', v: value.length > 500 ? value.slice(0, 500) + '…' : value }
    if (type === 'number' || type === 'boolean') return { t: type, v: value }
    if (type === 'bigint') return { t: 'bigint', v: String(value) }
    if (type === 'function') return { t: 'function', v: value.name || 'anonymous' }
    if (type === 'symbol') return { t: 'symbol', v: String(value) }
    if (value instanceof Date) return { t: 'date', v: isNaN(value) ? 'Invalid Date' : value.toISOString() }
    if (typeof Node !== 'undefined' && value instanceof Node) return { t: 'node', v: value.nodeName.toLowerCase() }
    if (value instanceof Promise) return { t: 'promise' }
    if (depth <= 0) return { t: Array.isArray(value) ? 'array' : 'object', n: sizeOf(value), more: true }
    if (Array.isArray(value)) {
      return { t: 'array', n: value.length, items: value.slice(0, 100).map(function (v) { return preview(v, depth - 1) }) }
    }
    if (value instanceof Map) {
      var entries = []
      value.forEach(function (v, k) {
        if (entries.length < 100) entries.push([String(k), preview(v, depth - 1)])
      })
      return { t: 'map', n: value.size, entries: entries }
    }
    if (value instanceof Set) {
      var items = []
      value.forEach(function (v) {
        if (items.length < 100) items.push(preview(v, depth - 1))
      })
      return { t: 'set', n: value.size, items: items }
    }
    var keys = Object.keys(value)
    return {
      t: 'object',
      n: keys.length,
      entries: keys.slice(0, 100).map(function (k) { return [k, preview(safeGet(value, k).value, depth - 1)] }),
    }
  }

  function sizeOf(v) {
    try {
      return Array.isArray(v) ? v.length : Object.keys(v).length
    } catch (e) {
      return 0
    }
  }

  Object.defineProperty(window, '__TYLIX_DEVTOOLS_HOOK__', { value: hook, configurable: true })
})()
