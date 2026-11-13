import type { WebSocket, WebSocketServer } from 'ws'

export interface ChannelHandlers {
  onConnect?: (ws: WebSocket) => void
  onMessage?: (ws: WebSocket, data: unknown) => void
  onDisconnect?: (ws: WebSocket) => void
}

export declare class ChannelServer {
  channels: Map<string, { handlers: ChannelHandlers; clients: Set<WebSocket> }>
  wss: WebSocketServer | null
  channel(name: string, handlers: ChannelHandlers): this
  /** Sends to this server's clients, and through the store to other channel servers. */
  broadcast(name: string, data: unknown): void
  /** Sends to this server's clients only. */
  deliver(name: string, data: unknown): void
  /** Relays broadcast() calls from the app and other channel servers to this server's clients. */
  connectStore(store: import('../store/index.js').Store): Promise<this>
  listen(port: number): WebSocketServer
}