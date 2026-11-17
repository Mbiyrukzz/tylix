// Svelte: the PWA instance is already a store.
//
//   import { pwa } from '@tylix/pwa/svelte'
//   {#if $pwa.updateAvailable}<button on:click={pwa.update}>Reload for the new version</button>{/if}
import { pwa as instance } from './client.js'

export const pwa = {
  subscribe: (run) => instance().subscribe(run),
  install: () => instance().install(),
  update: () => instance().update(),
  dismissUpdate: () => instance().dismissUpdate(),
  dismissOfflineReady: () => instance().dismissOfflineReady(),
}
