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
  broadcast(name: string, data: unknown): void
  listen(port: number): WebSocketServer
}