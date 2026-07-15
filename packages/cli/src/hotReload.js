import fs from "node:fs";
import path from "node:path";

/**
 * Recursively watches every subdirectory under `rootDir` for changes.
 * fs.watch's `recursive: true` option only works on macOS/Windows, so
 * on Linux we manually enumerate directories and watch each one.
 * Calls `onChange` (debounced) whenever any watched file changes.
 */
export function watchDirectoryTree(rootDir, onChange, { debounceMs = 150 } = {}) {
  const watchers = [];
  let debounceTimer = null;

  function scheduleChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, debounceMs);
  }

  function watchDir(dir) {
    if (!fs.existsSync(dir)) return;
    const watcher = fs.watch(dir, (eventType, filename) => {
      scheduleChange();
      // A new subdirectory may have appeared; pick it up.
      if (filename) {
        const fullPath = path.join(dir, filename);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          watchDir(fullPath);
        }
      }
    });
    watchers.push(watcher);

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        watchDir(path.join(dir, entry.name));
      }
    }
  }

  watchDir(rootDir);

  return {
    close() {
      clearTimeout(debounceTimer);
      watchers.forEach((w) => w.close());
    },
  };
}

/**
 * Registers a Server-Sent Events endpoint that pushes a "reload"
 * message to every connected browser whenever notify() is called.
 * The dev-server page injects a small client script that listens on
 * this endpoint and does location.reload().
 */
export function createHmrChannel(router, routePath = "/__tylix/hmr") {
  const clients = new Set();

  router.get(routePath, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write("\n");
    clients.add(res);
    req.on?.("close", () => clients.delete(res));
  });

  return {
    notify() {
      for (const res of clients) {
        res.write(`data: reload\n\n`);
      }
    },
  };
}

export const HMR_CLIENT_SCRIPT = `
<script>
(function () {
  var es = new EventSource("/__tylix/hmr");
  es.onmessage = function () { location.reload(); };
})();
</script>
`;
