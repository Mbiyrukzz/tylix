import { getStore } from '../store/index.js'

// Sends data to everyone on a channel, from anywhere in the app (an API
// handler, a job, an observer), whichever process runs the channel
// server. The message travels through the app's store, so it needs a
// shared driver (database or redis) when "tylix channels:work" runs as a
// separate process, which it does.
//
//   await broadcast('chat', { text: 'Deploy finished' })

export const CHANNEL_TOPIC = 'channels'

export async function broadcast(channel, data) {
  await getStore().publish(CHANNEL_TOPIC, { channel, data, from: 'app' })
}
