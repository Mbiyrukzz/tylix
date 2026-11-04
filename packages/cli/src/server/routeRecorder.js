// Records every route registered through it, so `tylix dev` can print
// what is actually served instead of guessing from manifests.
//
// Auth is detected through a shared symbol: anything returned by
// requireAuth (or the auth() helpers built on it) carries it. Symbol.for
// gives the same symbol in every package without an import.
const AUTH_MARK = Symbol.for('tylix.requireAuth')
const VERBS = ['get', 'post', 'put', 'patch', 'delete']

function isGuarded(handlers) {
  return handlers.some(
    (handler) => typeof handler === 'function' && handler[AUTH_MARK] === true,
  )
}

// "/api/authors/:id" and "/api/authors/:authorId" match the same URLs,
// so they count as the same route when looking for duplicates.
function shape(pattern) {
  return pattern.replace(/:[^/]+/g, ':param')
}

export function createRouteRecorder(router) {
  const routes = []
  const seen = new Map()
  let source = 'routes'

  function record(method, pattern, handlers) {
    if (typeof pattern !== 'string') return

    const upper = String(method).toUpperCase()
    const key = `${upper} ${shape(pattern)}`

    // The router answers with the first matching route, so a repeat is
    // dead code. Say so instead of letting it fail silently.
    if (seen.has(key)) {
      console.warn(
        `⚠ ${upper} ${pattern} is registered twice (${seen.get(key)}, then ${source}). ` +
          `The first one wins; the second is never reached.`,
      )
    } else {
      seen.set(key, source)
    }

    routes.push({
      method: upper,
      pattern,
      auth: isGuarded(handlers),
      source,
    })
  }

  // Methods are called on the real router, so anything the router does
  // internally (calling this.register from get, say) is never recorded twice.
  const recorded = new Proxy(router, {
    get(target, prop) {
      if (prop === 'register') {
        return (method, pattern, ...handlers) => {
          record(method, pattern, handlers)
          const result = target.register(method, pattern, ...handlers)
          return result === target ? recorded : result
        }
      }
      if (typeof prop === 'string' && VERBS.includes(prop)) {
        return (pattern, ...handlers) => {
          record(prop, pattern, handlers)
          const result = target[prop](pattern, ...handlers)
          return result === target ? recorded : result
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return {
    router: recorded,
    routes,
    setSource(label) {
      source = label
    },
  }
}