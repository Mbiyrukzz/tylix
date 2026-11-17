// Vue helpers. Install the plugin with the signed-in user (a ref, a
// getter, or a reactive object carrying `access`):
//
//   const { user } = useAuth()
//   app.use(permissionsPlugin(() => user.value))
//
// Then in templates:
//   <button v-can="'posts.create'">New post</button>        hidden when not allowed
//   <AdminPanel v-if="$can('role:admin')" />
// And in setup():
//   const canPublish = useCan('posts.publish')                 a computed boolean
import { computed, inject, unref } from 'vue'
import { createAbility, check } from './client.js'

const SOURCE = Symbol.for('tylix.permissions.source')

const read = (source) => (typeof source === 'function' ? source() : unref(source))

export function permissionsPlugin(source) {
  const current = () => read(source)
  const apply = (el, binding) => {
    const ok = check(current(), binding.value)
    const show = binding.modifiers.not ? !ok : ok
    if (!('tylixDisplay' in el.dataset)) el.dataset.tylixDisplay = el.style.display
    el.style.display = show ? el.dataset.tylixDisplay : 'none'
  }
  return {
    install(app) {
      app.provide(SOURCE, source)
      app.config.globalProperties.$can = (requirement) => check(current(), requirement)
      app.directive('can', { mounted: apply, updated: apply })
    },
  }
}

export function useAbility() {
  const source = inject(SOURCE, null)
  return computed(() => createAbility(read(source)))
}

export function useCan(requirement) {
  const source = inject(SOURCE, null)
  return computed(() => check(read(source), unref(requirement)))
}

export function useHasRole(role) {
  const ability = useAbility()
  return computed(() => ability.value.hasRole(unref(role)))
}
