// Svelte helpers. Turn a store of the signed-in user into a store of what
// they may do (works with Svelte 4 stores and Svelte 5's store contract):
//
//   import { auth } from '@tylix/svelte'
//   export const ability = abilityStore(auth.user)
//
//   {#if $ability.can('posts.create')} <NewPostButton /> {/if}
//   <button use:can={['posts.delete', $ability]}>Delete</button>
import { createAbility, check } from './client.js'

// Any store ({ subscribe }) or a plain value.
export function abilityStore(source) {
  if (!source || typeof source.subscribe !== 'function') {
    const fixed = createAbility(source)
    return { subscribe: (run) => (run(fixed), () => {}) }
  }
  return {
    subscribe(run) {
      const unsubscribe = source.subscribe((value) => run(createAbility(value)))
      return typeof unsubscribe === 'function' ? unsubscribe : () => unsubscribe?.unsubscribe?.()
    },
  }
}

// use:can={[requirement, abilityOrUser]}: hides the element when the
// check fails.
export function can(node, [requirement, source] = []) {
  const original = node.style.display
  const apply = ([req, src] = []) => {
    node.style.display = check(src, req) ? original : 'none'
  }
  apply([requirement, source])
  return { update: apply }
}
