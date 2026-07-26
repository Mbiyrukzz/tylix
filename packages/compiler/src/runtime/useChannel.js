export function useChannel(name) {
  const port = window.__TYLIX_CHANNELS_PORT__ ?? 6001
  const socket = new WebSocket(
    `ws://${window.location.hostname}:${port}/${name}`,
  )

  const listeners = []

  socket.addEventListener('message', (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }
    for (const fn of listeners) fn(data)
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
    onMessage(fn) {
      listeners.push(fn)
    },
    close() {
      socket.close()
    },
  }
}
