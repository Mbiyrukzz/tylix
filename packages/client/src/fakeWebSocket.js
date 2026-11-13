// A stand-in WebSocket for binding tests: records sockets, opens on the next
// tick, and lets a test push messages in.
export function installFakeWebSocket(target = globalThis) {
  const sockets = []
  class FakeWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.sent = []
      this.listeners = {}
      sockets.push(this)
      setTimeout(() => {
        if (this.readyState !== 0) return
        this.readyState = 1
        this.emit('open', {})
      }, 0)
    }
    addEventListener(type, fn) {
      ;(this.listeners[type] ??= []).push(fn)
    }
    emit(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event)
    }
    send(data) {
      this.sent.push(JSON.parse(data))
    }
    receive(data) {
      this.emit('message', { data: JSON.stringify(data) })
    }
    close() {
      this.readyState = 3
      this.emit('close', {})
    }
  }
  const previous = target.WebSocket
  target.WebSocket = FakeWebSocket
  return { sockets, restore: () => (target.WebSocket = previous) }
}
