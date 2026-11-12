export function useChannel(name) {
  const port = window.__TYLIX_CHANNELS_PORT__ ?? 6001
  // An https page may not open a plain ws:// socket (SecurityError).
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const listeners = []

  let socket
  try {
    socket = new WebSocket(
      `${scheme}://${window.location.hostname}:${port}/${name}`,
    )
  } catch (err) {
    // Return an inert channel so one failed socket does not take the
    // whole page down; the page can still render.
    console.error(`useChannel("${name}") could not connect:`, err)
    return {
      send() {},
      onMessage() {
        return () => {}
      },
      close() {},
    }
  }

  socket.addEventListener('message', (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }
    for (const fn of [...listeners]) fn(data)
  })

  return {
    send(data) {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(data))
      } else {
        socket.addEventListener(
          'open',
          () => socket.send(JSON.stringify(data)),
          { once: true },
        )
      }
    },
    // Returns an unsubscribe function.
    onMessage(fn) {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i !== -1) listeners.splice(i, 1)
      }
    },
    close() {
      socket.close()
    },
  }
}