// Live channels: a WebSocket to the channel server ("tylix channels:work")
// for one channel, e.g. "chat". Messages are JSON both ways.
//
//   const chat = channel('chat')
//   const stop = chat.onMessage((data) => console.log(data))
//   chat.send({ text: 'hi' })
//   chat.close()
//
// It reconnects on its own (0.5s, 1s, 2s … up to 10s apart) when the
// connection drops, and keeps messages sent while connecting until the
// socket opens. Where there is no WebSocket (server rendering) it does
// nothing, so pages can create channels unconditionally.

const MAX_QUEUE = 100
const MAX_DELAY_MS = 10_000

function channelUrl(name, { port, url }) {
  if (url) return url
  const location = globalThis.location
  const scheme = location?.protocol === 'https:' ? 'wss' : 'ws'
  const host = location?.hostname ?? 'localhost'
  // The Tylix server puts CHANNELS_PORT in the page; 6001 is its default.
  const finalPort = port ?? globalThis.__TYLIX_CHANNELS_PORT__ ?? 6001
  return `${scheme}://${host}:${finalPort}/${encodeURIComponent(name)}`
}

export function channel(name, options = {}) {
  if (typeof name !== 'string' || name === '') throw new TypeError('channel(name) needs a channel name.')
  const { reconnect = true } = options
  // An explicit WebSocket option wins, even undefined (no sockets here).
  const WebSocketImpl = Object.hasOwn(options, 'WebSocket') ? options.WebSocket : globalThis.WebSocket

  const messageListeners = new Set()
  const statusListeners = new Set()
  const queue = []
  let socket = null
  let status = 'connecting'
  let closedByUs = false
  let attempt = 0
  let retryTimer = null

  const setStatus = (next) => {
    if (next === status) return
    status = next
    for (const fn of [...statusListeners]) fn(status)
  }

  if (typeof WebSocketImpl !== 'function') {
    // Server rendering or a very old browser: an inert channel.
    status = 'closed'
    return {
      send() {},
      onMessage: () => () => {},
      onStatus: () => () => {},
      get status() {
        return 'closed'
      },
      close() {},
    }
  }

  function connect() {
    setStatus('connecting')
    try {
      socket = new WebSocketImpl(channelUrl(name, options))
    } catch (err) {
      console.error(`[tylix] channel("${name}") could not connect:`, err)
      scheduleRetry()
      return
    }
    socket.addEventListener('open', () => {
      attempt = 0
      setStatus('open')
      while (queue.length && socket.readyState === 1) socket.send(queue.shift())
    })
    socket.addEventListener('message', (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return // not JSON: not for us
      }
      for (const fn of [...messageListeners]) fn(data)
    })
    socket.addEventListener('close', () => {
      socket = null
      if (closedByUs) {
        setStatus('closed')
        return
      }
      scheduleRetry()
    })
  }

  function scheduleRetry() {
    if (closedByUs || !reconnect) {
      setStatus('closed')
      return
    }
    setStatus('reconnecting')
    const delay = Math.min(500 * 2 ** attempt, MAX_DELAY_MS)
    attempt++
    retryTimer = setTimeout(connect, delay)
  }

  connect()

  return {
    send(data) {
      const message = JSON.stringify(data)
      if (socket && socket.readyState === 1) socket.send(message)
      else if (!closedByUs) {
        queue.push(message)
        if (queue.length > MAX_QUEUE) queue.shift() // keep the newest
      }
    },
    // Returns a function that removes the listener.
    onMessage(fn) {
      messageListeners.add(fn)
      return () => messageListeners.delete(fn)
    },
    onStatus(fn) {
      statusListeners.add(fn)
      return () => statusListeners.delete(fn)
    },
    get status() {
      return status
    },
    close() {
      closedByUs = true
      clearTimeout(retryTimer)
      queue.length = 0
      if (socket) socket.close()
      else setStatus('closed')
    },
  }
}

// A channel opened later, for framework bindings: components create it
// while rendering (on the server too), open() it once mounted in the
// browser and close() it when unmounted. send() before open() is queued.
export function lazyChannel(name, { onMessage, onStatus } = {}) {
  let live = null
  const pending = []
  return {
    open() {
      if (live) return
      live = channel(name)
      live.onMessage((data) => onMessage?.(data))
      live.onStatus((status) => onStatus?.(status))
      onStatus?.(live.status)
      for (const data of pending.splice(0)) live.send(data)
    },
    close() {
      live?.close()
      live = null
    },
    send(data) {
      if (live) live.send(data)
      else pending.push(data)
    },
  }
}
