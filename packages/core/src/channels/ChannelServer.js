import { WebSocketServer } from 'ws'

export class ChannelServer {
  constructor() {
    this.channels = new Map()
    this.wss = null
  }

  channel(name, handlers) {
    this.channels.set(name, { handlers, clients: new Set() })
    return this
  }

  broadcast(name, data) {
    const channel = this.channels.get(name)
    if (!channel) return
    const message = JSON.stringify(data)
    for (const client of channel.clients) {
      if (client.readyState === client.OPEN) client.send(message)
    }
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
