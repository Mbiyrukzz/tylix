import { reactive } from '@tylix/compiler'

export function createProvider(setup) {
  const state = reactive(setup.state ? setup.state() : {})
  let inflight = null

  async function load(...args) {
    if (inflight) return inflight
    inflight = setup.fetch(state, ...args).finally(() => {
      inflight = null
    })
    return inflight
  }

  return { state, load, ...(setup.actions ? setup.actions(state) : {}) }
}
