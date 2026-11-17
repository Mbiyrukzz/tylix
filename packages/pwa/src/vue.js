// Vue: the PWA state as a readonly ref, plus its actions.
//
//   const { state, install, update } = usePwa()
//   <button v-if="state.updateAvailable" @click="update">Reload for the new version</button>
import { onScopeDispose, readonly, shallowRef, getCurrentScope } from 'vue'
import { pwa } from './client.js'

export function usePwa(options) {
  const instance = pwa(options)
  const state = shallowRef(instance.state)
  const stop = instance.subscribe((next) => {
    state.value = next
  })
  if (getCurrentScope()) onScopeDispose(stop)
  return {
    state: readonly(state),
    install: instance.install,
    update: instance.update,
    dismissUpdate: instance.dismissUpdate,
    dismissOfflineReady: instance.dismissOfflineReady,
  }
}
