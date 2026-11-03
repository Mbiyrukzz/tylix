import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'dist', 'build'])

// Colors only when writing to a real terminal and NO_COLOR isn't set.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const c = {
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
}

function statOrNull(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

/**
 * Counts saves and prints them to the terminal. Share one tracker between
 * several watchers (or across restarts) to keep a single running total.
 *
 *   record(kind, file)  kind: 'saved' | 'created' | 'removed'
 *   stats()             { totalSaves, files: { 'app/pages/index.tyx': 3 } }
 *   summary()           prints a per-file ranking
 */
export function createSaveTracker({ rootDir = process.cwd(), log = true } = {}) {
  const root = path.resolve(rootDir)
  const counts = new Map()
  let total = 0

  const rel = (file) => path.relative(root, file) || '.'

  return {
    record(kind, file) {
      let count = counts.get(file) ?? 0
      if (kind !== 'removed') {
        count++
        counts.set(file, count)
        total++
      }

      if (log) {
        const time = new Date().toLocaleTimeString()
        const tag = c.cyan('[tylix]')
        const label =
          kind === 'removed'
            ? c.red('removed')
            : kind === 'created'
              ? c.green('created')
              : c.green('saved  ')
        const stats =
          kind === 'removed' ? '' : ' ' + c.yellow(`(${count}x this file, ${total} total)`)
        console.log(`${c.dim(time)} ${tag} ${label} ${rel(file)}${stats}`)
      }
      return count
    },

    stats() {
      const files = {}
      for (const [file, count] of counts) files[rel(file)] = count
      return { totalSaves: total, files }
    },

    summary() {
      if (total === 0) return
      console.log(`\n${c.cyan('[tylix]')} ${total} save${total === 1 ? '' : 's'} this session:`)
      const sorted = [...counts].sort((a, b) => b[1] - a[1])
      for (const [file, count] of sorted) {
        console.log(`  ${String(count).padStart(3)}x  ${rel(file)}`)
      }
    },
  }
}

/**
 * Recursively watches every subdirectory under `rootDir` for changes.
 * fs.watch's `recursive: true` option only works on macOS/Windows, so
 * on Linux we manually enumerate directories and watch each one.
 *
 * `onChange(lastFile, changedFiles)` is called once per debounce window,
 * after real changes have been confirmed.
 *
 * Options:
 *   debounceMs  - quiet period before changes are flushed (default 150)
 *   ignore      - Set of names to skip (default: node_modules, .git, dist, build)
 *   log         - print saves to the terminal (default true)
 *   extensions  - e.g. ['.tyx', '.ts']; only report files with these extensions
 *   tracker     - a shared createSaveTracker(); one is created if omitted
 *
 * Dotfiles and editor backup files (ending in "~") are always skipped, so
 * watching a project root doesn't exhaust inotify watchers.
 */
export function watchDirectoryTree(
  rootDir,
  onChange,
  {
    debounceMs = 150,
    ignore = DEFAULT_IGNORE,
    log = true,
    extensions = null,
    tracker = createSaveTracker({ rootDir, log }),
  } = {},
) {
  const root = path.resolve(rootDir)
  const watchers = new Map() // dir -> FSWatcher
  const known = new Map() // file -> "mtimeMs:size" of last seen state
  const pending = new Set() // files touched during the current debounce window
  let debounceTimer = null
  let closed = false

  function shouldSkip(name) {
    return ignore.has(name) || name.startsWith('.') || name.endsWith('~')
  }

  function matchesExtension(file) {
    return !extensions || extensions.includes(path.extname(file))
  }

  function flush() {
    if (closed) return
    const files = [...pending]
    pending.clear()

    const changed = []
    for (const file of files) {
      const st = statOrNull(file)
      if (st?.isDirectory()) continue

      const prev = known.get(file)
      let kind

      if (!st) {
        // Deleted. Ignore paths we never knew about (e.g. temp files).
        if (prev === undefined) continue
        known.delete(file)
        kind = 'removed'
      } else {
        // fs.watch often fires several events per save, and editors that
        // "touch" a file without changing it also trigger events. Comparing
        // mtime + size filters those out so each real save counts once.
        const signature = `${st.mtimeMs}:${st.size}`
        if (signature === prev) continue
        known.set(file, signature)
        kind = prev === undefined ? 'created' : 'saved'
      }

      if (!matchesExtension(file)) continue

      tracker.record(kind, file)
      changed.push(file)
    }

    if (changed.length === 0) return

    try {
      onChange(changed[changed.length - 1], changed)
    } catch (err) {
      console.error(`${c.red('[tylix]')} onChange failed: ${err.message}`)
    }
  }

  function scheduleChange(file) {
    pending.add(file)
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flush, debounceMs)
  }

  function unwatchDir(dir) {
    // Close this directory's watcher and any watchers below it.
    for (const [watchedDir, watcher] of watchers) {
      if (watchedDir === dir || watchedDir.startsWith(dir + path.sep)) {
        watcher.close()
        watchers.delete(watchedDir)
      }
    }
  }

  function watchDir(dir) {
    if (closed || watchers.has(dir) || !fs.existsSync(dir)) return

    let watcher
    try {
      watcher = fs.watch(dir, (eventType, filename) => {
        if (closed) return
        const fullPath = filename ? path.join(dir, filename) : dir
        if (filename && shouldSkip(filename)) return

        // A watched subdirectory was removed: stop watching it.
        if (watchers.has(fullPath) && !fs.existsSync(fullPath)) {
          unwatchDir(fullPath)
          return
        }

        scheduleChange(fullPath)

        // A new subdirectory may have appeared; pick it up.
        if (filename && statOrNull(fullPath)?.isDirectory()) {
          watchDir(fullPath)
        }
      })
    } catch (err) {
      console.warn(`Could not watch ${dir}: ${err.message}`)
      return
    }

    watcher.on('error', () => {
      watcher.close()
      watchers.delete(dir)
    })
    watchers.set(dir, watcher)

    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        watchDir(fullPath)
      } else {
        // Record the starting state so the first save is "saved", not "created".
        const st = statOrNull(fullPath)
        if (st) known.set(fullPath, `${st.mtimeMs}:${st.size}`)
      }
    }
  }

  watchDir(root)

  return {
    tracker,
    stats: () => tracker.stats(),
    close() {
      if (closed) return
      closed = true
      clearTimeout(debounceTimer)
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    },
  }
}

/**
 * Registers a Server-Sent Events endpoint that pushes a "reload"
 * message to every connected browser whenever notify() is called.
 * The dev-server page injects a small client script that listens on
 * this endpoint and does location.reload().
 *
 * A heartbeat comment is sent periodically so proxies and browsers don't
 * drop idle connections. Dead connections are cleaned up automatically.
 */
export function createHmrChannel(
  router,
  routePath = '/__tylix/hmr',
  { heartbeatMs = 25_000 } = {},
) {
  const clients = new Set()

  router.get(routePath, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write('retry: 1000\n\n')
    clients.add(res)
    req.on?.('close', () => clients.delete(res))
  })

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n')
      } catch {
        clients.delete(res)
      }
    }
  }, heartbeatMs)
  heartbeat.unref?.()

  return {
    notify(files = []) {
      const payload = JSON.stringify({ type: 'reload', files })
      for (const res of clients) {
        try {
          res.write(`data: ${payload}\n\n`)
        } catch {
          clients.delete(res)
        }
      }
    },
    close() {
      clearInterval(heartbeat)
      for (const res of clients) res.end?.()
      clients.clear()
    },
  }
}

// Reloads on an explicit "reload" message, and also when the connection
// comes back after the dev server restarted (the old process is gone, so it
// can never send a message; the browser just sees the stream drop and
// reconnect).
export const HMR_CLIENT_SCRIPT = `
<script>
(function () {
  var wasDisconnected = false;
  var es = new EventSource("/__tylix/hmr");
  es.onmessage = function (e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.files && msg.files.length) {
        console.log("[tylix] reloading, changed:", msg.files.join(", "));
      }
    } catch (_) {}
    location.reload();
  };
  es.onerror = function () { wasDisconnected = true; };
  es.onopen = function () {
    if (wasDisconnected) location.reload();
  };
})();
</script>
`