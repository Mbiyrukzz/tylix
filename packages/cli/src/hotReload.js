import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'dist', 'build'])

/**
 * Recursively watches every subdirectory under `rootDir` for changes.
 * fs.watch's `recursive: true` option only works on macOS/Windows, so
 * on Linux we manually enumerate directories and watch each one.
 * Calls `onChange(filePath)` (debounced) whenever any watched file changes.
 *
 * Directories named in `ignore` (node_modules, .git, ...) and dotfiles are
 * skipped, so watching a project root doesn't exhaust inotify watchers.
 */
export function watchDirectoryTree(
  rootDir,
  onChange,
  { debounceMs = 150, ignore = DEFAULT_IGNORE } = {},
) {
  const watchers = []
  const watched = new Set()
  let debounceTimer = null
  let lastFile = null

  function scheduleChange(file) {
    lastFile = file
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => onChange(lastFile), debounceMs)
  }

  function shouldSkip(name) {
    return ignore.has(name) || name.startsWith('.')
  }

  function watchDir(dir) {
    if (watched.has(dir) || !fs.existsSync(dir)) return
    watched.add(dir)

    let watcher
    try {
      watcher = fs.watch(dir, (eventType, filename) => {
        const fullPath = filename ? path.join(dir, filename) : dir
        if (filename && shouldSkip(filename)) return

        scheduleChange(fullPath)

        // A new subdirectory may have appeared; pick it up.
        try {
          if (filename && fs.statSync(fullPath).isDirectory()) {
            watchDir(fullPath)
          }
        } catch {
          // File was deleted between the event and the stat; nothing to watch.
        }
      })
    } catch (err) {
      console.warn(`Could not watch ${dir}: ${err.message}`)
      return
    }

    watcher.on('error', () => {
      watched.delete(dir)
    })
    watchers.push(watcher)

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !shouldSkip(entry.name)) {
        watchDir(path.join(dir, entry.name))
      }
    }
  }

  watchDir(rootDir)

  return {
    close() {
      clearTimeout(debounceTimer)
      watchers.forEach((w) => w.close())
    },
  }
}

/**
 * Registers a Server-Sent Events endpoint that pushes a "reload"
 * message to every connected browser whenever notify() is called.
 * The dev-server page injects a small client script that listens on
 * this endpoint and does location.reload().
 */
export function createHmrChannel(router, routePath = '/__tylix/hmr') {
  const clients = new Set()

  router.get(routePath, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.write('\n')
    clients.add(res)
    req.on?.('close', () => clients.delete(res))
  })

  return {
    notify() {
      for (const res of clients) {
        res.write(`data: reload\n\n`)
      }
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
  es.onmessage = function () { location.reload(); };
  es.onerror = function () { wasDisconnected = true; };
  es.onopen = function () {
    if (wasDisconnected) location.reload();
  };
})();
</script>
`