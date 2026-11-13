// Query timing for logs and metrics. Every SQL adapter reports each
// statement it runs, with its duration, to the listeners registered here:
//
//   const stop = onQuery(({ driver, sql, durationMs, error }) => { ... })
//
// With no listeners nothing is timed, so this costs nothing by default.
const listeners = new Set()

export function onQuery(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hasQueryListeners() {
  return listeners.size > 0
}

export function emitQuery(event) {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // A broken listener must never fail the query.
    }
  }
}
