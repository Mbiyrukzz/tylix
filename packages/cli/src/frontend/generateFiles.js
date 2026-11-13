// What `tylix make:page` and `tylix make:component` write for each hosted
// frontend (React, Svelte, Vue, Angular). Pure functions, so every
// framework's output can be tested without a project on disk.

import { kebabCase, titleCase } from '@tylix/shared'

// Lines that mark where make:page inserts into the starter's route file.
// Starters since SSR have them; older projects get the lines printed.
export const IMPORTS_MARKER = 'tylix:imports'
export const ROUTES_MARKER = 'tylix:routes'

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/

// A segment is already letters and digits, so capitalising is enough.
const pascal = (segment) => segment[0].toUpperCase() + segment.slice(1)
const kebab = kebabCase

// "admin/UserSettings" ->
//   folders ['admin'], base 'UserSettings',
//   identifier 'AdminUserSettings' (unique in the route file),
//   routePath '/admin/user-settings', selector 'admin-user-settings'
export function parseName(name) {
  const segments = String(name ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.length === 0 || !segments.every((s) => SEGMENT.test(s))) {
    throw new Error(
      `"${name}" is not a valid name. Use letters and digits, optionally in folders: Settings, admin/UserSettings.`,
    )
  }
  const folders = segments.slice(0, -1)
  const base = pascal(segments[segments.length - 1])
  return {
    folders,
    base,
    identifier: [...folders, base].map(pascal).join(''),
    routePath: '/' + [...folders, base].map(kebab).join('/'),
    selector: [...folders, base].map(kebab).join('-'),
  }
}

const join = (...parts) => parts.filter(Boolean).join('/')

function pageBody(title, file) {
  return {
    heading: titleCase(title),
    hint: `Edit app/frontend/${file} to change this page.`,
  }
}

// ---- pages -------------------------------------------------------------

function reactPage(n, ts) {
  const file = join('pages', ...n.folders, `${n.base}.${ts ? 'tsx' : 'jsx'}`)
  const { heading, hint } = pageBody(n.base, file)
  return {
    file,
    content: `// Pages render; data comes from a provider on this page's route (see
// AppRoutes and providers/), which calls the API through services/.
export default function ${n.base}() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">${heading}</h1>
      <p className="mt-2 text-zinc-500">${hint}</p>
    </section>
  )
}
`,
    importLine: `import ${n.identifier} from './${join('pages', ...n.folders, n.base)}'`,
    routeLine: (auth) =>
      auth
        ? `<Route path="${n.routePath.slice(1)}" element={<RequireAuth fallback={<RedirectToLogin />} loading={<PageLoading />}><${n.identifier} /></RequireAuth>} />`
        : `<Route path="${n.routePath.slice(1)}" element={<${n.identifier} />} />`,
  }
}

function vuePage(n, ts) {
  const file = join('pages', ...n.folders, `${n.base}.vue`)
  const { heading, hint } = pageBody(n.base, file)
  return {
    file,
    content: `<script setup${ts ? ' lang="ts"' : ''}>
// Data: const { data } = useApi('/api/...') from '@tylix/vue'
</script>

<template>
  <section class="max-w-6xl mx-auto px-6 py-12">
    <h1 class="text-3xl font-semibold tracking-tight">${heading}</h1>
    <p class="mt-2 text-zinc-500">${hint}</p>
  </section>
</template>
`,
    importLine: `import ${n.identifier} from './${join('pages', ...n.folders, `${n.base}.vue`)}'`,
    routeLine: (auth) =>
      auth
        ? `{ path: '${n.routePath}', component: ${n.identifier}, meta: { access: 'auth' } },`
        : `{ path: '${n.routePath}', component: ${n.identifier} },`,
  }
}

function sveltePage(n, ts) {
  const file = join('pages', ...n.folders, `${n.base}.svelte`)
  const { heading, hint } = pageBody(n.base, file)
  return {
    file,
    content: `<script${ts ? ' lang="ts"' : ''}>
  // Data: const items = useApi('/api/...') from '@tylix/svelte', then $items.data
</script>

<section class="max-w-6xl mx-auto px-6 py-12">
  <h1 class="text-3xl font-semibold tracking-tight">${heading}</h1>
  <p class="mt-2 text-zinc-500">${hint}</p>
</section>
`,
    importLine: `import ${n.identifier} from './${join('pages', ...n.folders, `${n.base}.svelte`)}'`,
    routeLine: (auth) => `{ path: '${n.routePath}', page: ${n.identifier}, access: '${auth ? 'auth' : 'any'}' },`,
  }
}

function angularPage(n) {
  const fileBase = kebab(n.base)
  const file = join('pages', ...n.folders, `${fileBase}.ts`)
  const { heading, hint } = pageBody(n.base, file)
  return {
    file,
    content: `import { Component } from '@angular/core'

@Component({
  selector: 'app-${n.selector}',
  template: \`
    <section class="max-w-6xl mx-auto px-6 py-12">
      <h1 class="text-3xl font-semibold tracking-tight">${heading}</h1>
      <p class="mt-2 text-zinc-500">${hint}</p>
    </section>
  \`,
})
export class ${n.identifier} {
  // Data: protected readonly items = injectApi<Item[]>('/api/...') from '@tylix/angular'
}
`,
    importLine: `import { ${n.identifier} } from './${join('pages', ...n.folders, fileBase)}'`,
    routeLine: (auth) =>
      auth
        ? `{ path: '${n.routePath.slice(1)}', component: ${n.identifier}, canActivate: [authGuard], data: { access: 'auth' } },`
        : `{ path: '${n.routePath.slice(1)}', component: ${n.identifier} },`,
  }
}

const PAGES = { react: reactPage, vue: vuePage, svelte: sveltePage, angular: angularPage }

// The file each frontend's routes live in, relative to app/frontend.
export function routeFile(driver, ts) {
  switch (driver) {
    case 'react':
      return ts ? 'AppRoutes.tsx' : 'AppRoutes.jsx'
    case 'vue':
      return ts ? 'router.ts' : 'router.js'
    case 'svelte':
      return 'App.svelte'
    case 'angular':
      return 'app.routes.ts'
    default:
      throw new Error(`No hosted frontend "${driver}".`)
  }
}

// The route file a project actually has: the current one, or the older
// location (React's App.jsx) when only that exists. `exists` checks a
// path relative to app/frontend.
export async function findRouteFile(driver, ts, exists) {
  const current = routeFile(driver, ts)
  const legacy = legacyRouteFile(driver, ts)
  if (legacy && !(await exists(current)) && (await exists(legacy))) return legacy
  return current
}

// Where projects made before a frontend's current layout keep their routes
// (React starters used to route in App.jsx), or null.
export function legacyRouteFile(driver, ts) {
  return driver === 'react' ? (ts ? 'App.tsx' : 'App.jsx') : null
}

export function pageFiles(driver, name, { ts = false } = {}) {
  const make = PAGES[driver]
  if (!make) throw new Error(`No hosted frontend "${driver}".`)
  const n = parseName(name)
  return { ...make(n, ts || driver === 'angular'), name: n }
}

// ---- components --------------------------------------------------------

export function componentFile(driver, name, { ts = false } = {}) {
  const n = parseName(name)
  switch (driver) {
    case 'react':
      return {
        file: join('components', ...n.folders, `${n.base}.${ts ? 'tsx' : 'jsx'}`),
        content: ts
          ? `import type { ReactNode } from 'react'

export default function ${n.base}({ children }: { children?: ReactNode }) {
  return <div>{children}</div>
}
`
          : `export default function ${n.base}({ children }) {
  return <div>{children}</div>
}
`,
      }
    case 'vue':
      return {
        file: join('components', ...n.folders, `${n.base}.vue`),
        content: `<script setup${ts ? ' lang="ts"' : ''}>
// Props: ${ts ? 'defineProps<{ title: string }>()' : "defineProps({ title: String })"}
</script>

<template>
  <div>
    <slot />
  </div>
</template>
`,
      }
    case 'svelte':
      return {
        file: join('components', ...n.folders, `${n.base}.svelte`),
        content: ts
          ? `<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet } = $props()
</script>

<div>
  {@render children?.()}
</div>
`
          : `<script>
  let { children } = $props()
</script>

<div>
  {@render children?.()}
</div>
`,
      }
    case 'angular':
      return {
        file: join('components', ...n.folders, `${kebab(n.base)}.ts`),
        content: `import { Component } from '@angular/core'

@Component({
  selector: 'app-${n.selector}',
  template: \`
    <div>
      <ng-content />
    </div>
  \`,
})
export class ${n.identifier} {}
`,
      }
    default:
      throw new Error(`No hosted frontend "${driver}".`)
  }
}

// ---- route registration ----------------------------------------------

// Inserts `line` above the line holding `marker`, with the marker line's
// indentation. Returns null when the marker isn't there.
export function insertAtMarker(source, marker, line) {
  const lines = source.split('\n')
  const at = lines.findIndex((l) => l.includes(marker))
  if (at === -1) return null
  const indent = lines[at].match(/^\s*/)[0]
  lines.splice(at, 0, indent + line)
  return lines.join('\n')
}

// Adds a page's import and route to the route file's source. Returns
// { source } on success, or { missing } naming what wasn't found.
export function registerRoute(source, page, { auth = false } = {}) {
  const importPattern = new RegExp(`\\b(import\\s+(\\{\\s*)?${page.name.identifier}\\b)`)
  if (importPattern.test(source)) {
    return { conflict: `${page.name.identifier} is already imported in the route file.` }
  }
  const withImport = insertAtMarker(source, IMPORTS_MARKER, page.importLine)
  if (withImport === null) return { missing: IMPORTS_MARKER }
  const withRoute = insertAtMarker(withImport, ROUTES_MARKER, page.routeLine(auth))
  if (withRoute === null) return { missing: ROUTES_MARKER }
  return { source: withRoute }
}

// ---- channel demo pages (make:channel) ----------------------------------

const CHAT_CLASSES = {
  section: 'max-w-xl mx-auto px-6 py-12',
  list: 'mt-6 space-y-2',
  item: 'rounded-lg border border-zinc-200 px-3 py-2',
  form: 'mt-6 flex gap-2',
  input: 'flex-1 rounded-lg border border-zinc-300 px-3 py-2',
  button: 'rounded-lg bg-zinc-900 px-4 py-2 text-white disabled:opacity-50',
}

function channelContent(driver, n, channel, ts) {
  const c = CHAT_CLASSES
  const heading = titleCase(n.base)
  const intro = `Live on the "${channel}" channel. Open this page in two tabs; run "tylix channels:work" next to "tylix dev".`
  switch (driver) {
    case 'react':
      return `import { useState${ts ? ', type FormEvent' : ''} } from 'react'
import { useChannel } from '@tylix/react'
${ts ? '\ntype Message = { text: string; at: string }\n' : ''}
export default function ${n.base}() {
  const [messages, setMessages] = useState${ts ? '<Message[]>' : ''}([])
  const [text, setText] = useState('')
  const { send, status } = useChannel${ts ? '<Message>' : ''}('${channel}', (message) => setMessages((list) => [...list, message]))

  function submit(event${ts ? ': FormEvent' : ''}) {
    event.preventDefault()
    if (!text.trim()) return
    send({ text: text.trim(), at: new Date().toISOString() })
    setText('')
  }

  return (
    <section className="${c.section}">
      <h1 className="text-3xl font-semibold tracking-tight">${heading}</h1>
      <p className="mt-2 text-zinc-500">${intro}</p>
      <p className="mt-2 text-sm">Status: {status}</p>
      <ul className="${c.list}">
        {messages.map((message, i) => (
          <li key={i} className="${c.item}">{message.text}</li>
        ))}
      </ul>
      <form className="${c.form}" onSubmit={submit}>
        <input className="${c.input}" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" />
        <button className="${c.button}" disabled={status !== 'open'}>Send</button>
      </form>
    </section>
  )
}
`
    case 'vue':
      return `<script setup${ts ? ' lang="ts"' : ''}>
import { ref } from 'vue'
import { useChannel } from '@tylix/vue'
${ts ? '\ntype Message = { text: string; at: string }\n' : ''}
const messages = ref${ts ? '<Message[]>' : ''}([])
const text = ref('')
const { send, status } = useChannel${ts ? '<Message>' : ''}('${channel}', (message) => messages.value.push(message))

function submit() {
  if (!text.value.trim()) return
  send({ text: text.value.trim(), at: new Date().toISOString() })
  text.value = ''
}
</script>

<template>
  <section class="${c.section}">
    <h1 class="text-3xl font-semibold tracking-tight">${heading}</h1>
    <p class="mt-2 text-zinc-500">${intro}</p>
    <p class="mt-2 text-sm">Status: {{ status }}</p>
    <ul class="${c.list}">
      <li v-for="(message, i) in messages" :key="i" class="${c.item}">{{ message.text }}</li>
    </ul>
    <form class="${c.form}" @submit.prevent="submit">
      <input v-model="text" class="${c.input}" placeholder="Say something" />
      <button class="${c.button}" :disabled="status !== 'open'">Send</button>
    </form>
  </section>
</template>
`
    case 'svelte':
      return `<script${ts ? ' lang="ts"' : ''}>
  import { useChannel } from '@tylix/svelte'
${ts ? '\n  type Message = { text: string; at: string }\n' : ''}
  let messages${ts ? ': Message[]' : ''} = []
  let text = ''
  const chat = useChannel${ts ? '<Message>' : ''}('${channel}', (message) => (messages = [...messages, message]))
  const status = chat.status

  function submit() {
    if (!text.trim()) return
    chat.send({ text: text.trim(), at: new Date().toISOString() })
    text = ''
  }
</script>

<section class="${c.section}">
  <h1 class="text-3xl font-semibold tracking-tight">${heading}</h1>
  <p class="mt-2 text-zinc-500">${intro}</p>
  <p class="mt-2 text-sm">Status: {$status}</p>
  <ul class="${c.list}">
    {#each messages as message, i (i)}
      <li class="${c.item}">{message.text}</li>
    {/each}
  </ul>
  <form class="${c.form}" on:submit|preventDefault={submit}>
    <input bind:value={text} class="${c.input}" placeholder="Say something" />
    <button class="${c.button}" disabled={$status !== 'open'}>Send</button>
  </form>
</section>
`
    case 'angular':
      return `import { Component, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { injectChannel } from '@tylix/angular'

type Message = { text: string; at: string }

@Component({
  selector: 'app-${n.selector}',
  imports: [FormsModule],
  template: \`
    <section class="${c.section}">
      <h1 class="text-3xl font-semibold tracking-tight">${heading}</h1>
      <p class="mt-2 text-zinc-500">${intro}</p>
      <p class="mt-2 text-sm">Status: {{ chat.status() }}</p>
      <ul class="${c.list}">
        @for (message of messages(); track $index) {
          <li class="${c.item}">{{ message.text }}</li>
        }
      </ul>
      <form class="${c.form}" (ngSubmit)="submit()">
        <input [(ngModel)]="text" name="text" class="${c.input}" placeholder="Say something" />
        <button class="${c.button}" [disabled]="chat.status() !== 'open'">Send</button>
      </form>
    </section>
  \`,
})
export class ${n.identifier} {
  protected readonly messages = signal<Message[]>([])
  protected text = ''
  protected readonly chat = injectChannel<Message>('${channel}', (message) =>
    this.messages.update((list) => [...list, message]),
  )

  protected submit() {
    if (!this.text.trim()) return
    this.chat.send({ text: this.text.trim(), at: new Date().toISOString() })
    this.text = ''
  }
}
`
    default:
      throw new Error(`No hosted frontend "${driver}".`)
  }
}

// A page that joins a channel: a message list, an input and the status.
// Same file, import and route as make:page would give the name.
export function channelPageFiles(driver, name, channel, { ts = false } = {}) {
  const page = pageFiles(driver, name, { ts })
  return { ...page, content: channelContent(driver, page.name, channel, ts || driver === 'angular') }
}
