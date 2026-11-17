import { test } from 'node:test'
import assert from 'node:assert/strict'

const editor = { id: 1, access: { roles: ['editor', 'writer'], permissions: ['posts.*'], denied: ['posts.delete'], superAdmin: false } }

test('react: <Can> and useCan follow the provider', async () => {
  const { createElement: h } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { PermissionsProvider, Can, useCan } = await import('../src/react.js')
  function Probe() {
    return h('i', null, useCan('posts.delete') ? 'yes' : 'no')
  }
  const html = renderToStaticMarkup(
    h(PermissionsProvider, { user: editor },
      h(Can, { permission: 'posts.edit' }, h('b', null, 'edit')),
      h(Can, { permission: 'posts.delete', fallback: h('s', null, 'nodelete') }, h('b', null, 'delete')),
      h(Can, { role: 'admin' }, h('b', null, 'admin')),
      h(Can, { any: ['users.manage', 'posts.view'] }, h('u', null, 'any')),
      h(Probe)),
  )
  assert.equal(html, '<b>edit</b><s>nodelete</s><u>any</u><i>no</i>')
  // No provider: a guest.
  assert.equal(renderToStaticMarkup(h(Can, { permission: 'posts.edit', fallback: 'guest' }, 'x')), 'guest')
})

test('vue: plugin, $can and useCan', async () => {
  const { createSSRApp, h, ref, defineComponent } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { permissionsPlugin, useCan } = await import('../src/vue.js')
  const user = ref(editor)
  const App = defineComponent({
    setup() {
      const canEdit = useCan('posts.edit')
      return () => h('p', null, `${canEdit.value}`)
    },
  })
  const app = createSSRApp(App)
  app.use(permissionsPlugin(() => user.value))
  assert.equal(await renderToString(app), '<p>true</p>')
  assert.equal(app.config.globalProperties.$can('posts.delete'), false)
  user.value = null
  assert.equal(app.config.globalProperties.$can('posts.edit'), false)
})

test('svelte: abilityStore follows the user store', async () => {
  const { writable, get } = await import('svelte/store')
  const { abilityStore } = await import('../src/svelte.js')
  const user = writable(null)
  const ability = abilityStore(user)
  assert.equal(get(ability).can('posts.edit'), false)
  user.set(editor)
  assert.equal(get(ability).can('posts.edit'), true)
  assert.equal(get(abilityStore(editor)).hasRole('writer'), true)
})

test('angular: injectCan reads the provided signal', async () => {
  await import('@angular/compiler') // JIT: Node loads Angular unlinked here
  const { signal, Injector, runInInjectionContext } = await import('@angular/core')
  const { providePermissions, injectCan, injectAbility } = await import('../src/angular.js')
  const user = signal(null)
  const injector = Injector.create({ providers: [providePermissions(() => user)] })
  runInInjectionContext(injector, () => {
    const can = injectCan()
    const ability = injectAbility()
    assert.equal(can('posts.edit'), false)
    user.set(editor)
    assert.equal(can('posts.edit'), true)
    assert.equal(ability().hasRole('editor'), true)
  })
})
