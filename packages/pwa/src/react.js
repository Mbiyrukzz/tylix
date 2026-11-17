// React: the PWA state as a hook.
//
//   const { installable, updateAvailable, online, install, update } = usePwa()
//   {updateAvailable && <button onClick={update}>Reload for the new version</button>}
import { useSyncExternalStore } from 'react'
import { pwa } from './client.js'

export function usePwa(options) {
  const instance = pwa(options)
  const state = useSyncExternalStore(
    (onChange) => instance.subscribe(onChange),
    () => instance.state,
    () => instance.state,
  )
  return {
    ...state,
    install: instance.install,
    update: instance.update,
    dismissUpdate: instance.dismissUpdate,
    dismissOfflineReady: instance.dismissOfflineReady,
  }
}
