import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'
import { CHANNEL_TOPIC } from './broadcast.js'

export class ChannelServer {
  constructor() {
    this.channels = new Map()
    this.wss = null
    // Marks this server's own relayed messages, which it has delivered already.
    this.id = randomUUID()
  }

  channel(name, handlers) {
    this.channels.set(name, { handlers, clients: new Set() })
    return this
  }

  // Sends to this server's clients on `name`, and through the store (when
  // connected) to the clients of every other channel server.
  broadcast(name, data) {
    this.deliver(name, data)
    this.store?.publish(CHANNEL_TOPIC, { channel: name, data, from: this.id }).catch((err) => {
      console.error('[tylix] Could not relay a channel message:', err.message)
    })
  }

  deliver(name, data) {
    const channel = this.channels.get(name)
    if (!channel) return
    const message = JSON.stringify(data)
    for (const client of channel.clients) {
      if (client.readyState === client.OPEN) client.send(message)
    }
  }

  // Receives broadcast() calls from the app and from other channel
  // servers through the store, and relays them to this server's clients.
  async connectStore(store) {
    this.store = store
    this.unsubscribe = await store.subscribe(CHANNEL_TOPIC, (message) => {
      if (message?.from === this.id || typeof message?.channel !== 'string') return
      this.deliver(message.channel, message.data)
    })
    return this
  }

  listen(port) {
    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`)
      const channelName = url.pathname.slice(1)
      const channel = this.channels.get(channelName)

      if (!channel) {
        ws.close(1008, `Unknown channel "${channelName}"`)
        return
      }

      channel.clients.add(ws)
      channel.handlers.onConnect?.(ws)

      ws.on('message', (raw) => {
        let data
        try {
          data = JSON.parse(raw.toString())
        } catch {
          return // malformed message, ignore rather than crash the connection
        }
        channel.handlers.onMessage?.(ws, data)
      })

      ws.on('close', () => {
        channel.clients.delete(ws)
        channel.handlers.onDisconnect?.(ws)
      })
    })

    return this.wss
  }
}
