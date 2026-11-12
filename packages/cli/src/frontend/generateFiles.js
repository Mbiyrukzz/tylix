// What `tylix make:page` and `tylix make:component` write for each hosted
// frontend (React, Svelte, Vue, Angular). Pure functions, so every
// framework's output can be tested without a project on disk.

// Lines that mark where make:page inserts into the starter's route file.
// Starters since SSR have them; older projects get the lines printed.
export const IMPORTS_MARKER = 'tylix:imports'
export const ROUTES_MARKER = 'tylix:routes'

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/

const pascal = (segment) => segment[0].toUpperCase() + segment.slice(1)
const kebab = (segment) =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

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
    heading: title.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
    hint: `Edit app/frontend/${file} to change this page.`,
  }
}

// ---- pages -------------------------------------------------------------

function reactPage(n, ts) {
  const file = join('pages', ...n.folders, `${n.base}.${ts ? 'tsx' : 'jsx'}`)
  const { heading, hint } = pageBody(n.base, file)
  return {
    file,
    content: `export default function ${n.base}() {
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
      return ts ? 'App.tsx' : 'App.jsx'
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
