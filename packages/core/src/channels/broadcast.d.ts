/** Sends data to everyone on a channel, from any process of the app (through the store). */
export declare function broadcast(channel: string, data: unknown): Promise<void>
export declare const CHANNEL_TOPIC: string
