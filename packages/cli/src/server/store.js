// Sets up the app's store (STORE_DRIVER) for this process: rate limits,
// the cache and channel messages go through it.
import { addReadinessCheck, createStore, logger, setStore } from '@tylix/core'

export async function openStore(config, { role = 'server' } = {}) {
  const store = await createStore(config.store)
  setStore(store)
  if (store.driver === 'redis') addReadinessCheck('store', () => store.get('__ready'))
  if (store.driver === 'memory' && role === 'channels') {
    logger.warn('STORE_DRIVER=memory: broadcast() from the app cannot reach this channel server. Use database or redis.')
  }
  return store
}
