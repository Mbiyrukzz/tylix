import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { exists } from '@tylix/shared'
import { offlinePage } from '@tylix/pwa'

// tylix make:pwa: an installable app that works offline.
//
//   tylix.config        pwa: { name, shortName, themeColor, backgroundColor }
//   public/             pwa-192.png, pwa-512.png, pwa-maskable-512.png,
//                       apple-touch-icon.png (the Tylix mark; replace them) and offline.html
//   native pages        app/capabilities/Pwa.tyx and an update/install prompt
//                       (app/pages/components/PwaPrompt.tyx) in the layout
//
// The manifest, the service worker and its registration are served by
// Tylix itself. Files that exist are kept.

const require = createRequire(import.meta.url)
const cliVersion = require('../../package.json').version
// @tylix/pwa resolves to src/index.js; its icons sit in ../assets.
const ASSETS = path.join(path.dirname(require.resolve('@tylix/pwa')), '..', 'assets')

const titleCase = (name) =>
  String(name ?? 'Tylix app')
    .replace(/^@[^/]+\//, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

export function pwaConfigBlock(name) {
  const shortName = name.length > 12 ? name.split(' ')[0].slice(0, 12) : name
  return `  // Installable app and offline support (@tylix/pwa). Tylix serves the
  // manifest and the service worker; icons and offline.html are in public/.
  // Pages are never cached (they can hold a signed-in user's data): offline
  // visitors get public/offline.html. See the @tylix/pwa README for caching
  // rules, shortcuts and screenshots.
  pwa: {
    name: ${JSON.stringify(name)},
    shortName: ${JSON.stringify(shortName)},
    themeColor: "#0034CA",
    backgroundColor: "#ffffff",
  },
`
}

export function patchConfig(source, name) {
  if (/\bpwa\s*:/.test(source)) return source
  const open = /export\s+default\s+(?:defineConfig\s*\(\s*)?\{\s*\n/.exec(source)
  if (!open) return null
  const at = open.index + open[0].length
  return source.slice(0, at) + pwaConfigBlock(name) + source.slice(at)
}

export const PWA_CAPABILITY = `capability Pwa

// The installable-app state, for .tyx pages: Pwa.installable,
// Pwa.updateAvailable, Pwa.online, and Pwa.install(), Pwa.update().
// It reads the runtime Tylix puts on every page when pwa is on in
// tylix.config; without it, everything stays false.

state
  supported: false
  installable: false
  installed: false
  updateAvailable: false
  offlineReady: false
  online: true

action
  async install() {
    const pwa = window.__TYLIX_PWA__
    if not pwa {
      return "unavailable"
    }
    return await pwa.install()
  }

  update() {
    const pwa = window.__TYLIX_PWA__
    if pwa {
      pwa.update()
    }
  }

  dismissUpdate() {
    const pwa = window.__TYLIX_PWA__
    if pwa {
      pwa.dismissUpdate()
    }
  }

  dismissOfflineReady() {
    const pwa = window.__TYLIX_PWA__
    if pwa {
      pwa.dismissOfflineReady()
    }
  }

init
  async {
    const pwa = window.__TYLIX_PWA__
    if not pwa {
      return null
    }
    pwa.subscribe(s => {
      this.supported = s.supported
      this.installable = s.installable
      this.installed = s.installed
      this.updateAvailable = s.updateAvailable
      this.offlineReady = s.offlineReady
      this.online = s.online
    })
  }
`

export const PWA_PROMPT = `component PwaPrompt

// New version, offline-ready and install prompts, bottom right. In the
// layout, so every page has them. Edit freely.

uses
  Pwa

state
  hideInstall: false

action
  dismissInstall() {
    this.hideInstall = true
    try {
      localStorage.setItem("tylix:pwa-install-dismissed", "1")
    } catch (err) {
      return null
    }
  }

  async install() {
    await Pwa.install()
  }

onMount
  {
    try {
      this.hideInstall = localStorage.getItem("tylix:pwa-install-dismissed") is "1"
    } catch (err) {
      this.hideInstall = false
    }
  }

template
<div class="pwa-stack" aria-live="polite">
{{#if not Pwa.online}}
  <div class="pwa-pill" role="status"><span class="pwa-dot"></span> You’re offline</div>
{{/if}}
{{#if Pwa.updateAvailable}}
  <div class="tx-panel pwa-toast" role="status">
    <div>
      <p class="pwa-title">A new version is ready</p>
      <p class="pwa-text">Reload to get the latest.</p>
    </div>
    <div class="pwa-actions">
      <button class="tx-btn tx-btn-ghost tx-btn-sm" onclick="{{ Pwa.dismissUpdate() }}">Later</button>
      <button class="tx-btn tx-btn-primary tx-btn-sm" onclick="{{ Pwa.update() }}">Reload</button>
    </div>
  </div>
{{#else if Pwa.offlineReady}}
  <div class="tx-panel pwa-toast" role="status">
    <div>
      <p class="pwa-title">Ready to work offline</p>
      <p class="pwa-text">Pages you visit stay available without a connection.</p>
    </div>
    <div class="pwa-actions">
      <button class="tx-btn tx-btn-ghost tx-btn-sm" onclick="{{ Pwa.dismissOfflineReady() }}">OK</button>
    </div>
  </div>
{{#else if Pwa.installable and not hideInstall}}
  <div class="tx-panel pwa-toast" role="status">
    <div>
      <p class="pwa-title">Install this app</p>
      <p class="pwa-text">Open it from your home screen or dock, like any other app.</p>
    </div>
    <div class="pwa-actions">
      <button class="tx-btn tx-btn-ghost tx-btn-sm" onclick="{{ dismissInstall() }}">Not now</button>
      <button class="tx-btn tx-btn-primary tx-btn-sm" onclick="{{ install() }}">Install</button>
    </div>
  </div>
{{/if}}
</div>

style
.pwa-stack { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; max-width: calc(100vw - 2rem); pointer-events: none; }
.pwa-stack > * { pointer-events: auto; }
.pwa-toast { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1.25rem; width: 24rem; max-width: 100%; padding: 1rem 1.125rem; box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.35); animation: pwa-rise 0.2s ease-out; }
.pwa-toast > div:first-child { flex: 1 1 14rem; min-width: 0; }
.pwa-title { margin: 0; font-size: 0.875rem; font-weight: 600; }
.pwa-text { margin: 0.125rem 0 0; font-size: 0.8125rem; color: rgb(var(--tx-muted)); }
.pwa-actions { display: flex; gap: 0.375rem; margin-left: auto; }
.pwa-pill { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; border-radius: 999px; font-size: 0.8125rem; font-weight: 500; color: rgb(var(--tx-ink)); background: rgb(var(--tx-panel)); border: 1px solid rgb(var(--tx-line)); box-shadow: var(--tx-shadow); }
.pwa-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: rgb(var(--tx-coral)); }
@keyframes pwa-rise { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .pwa-toast { animation: none; } }
`

// The same prompt for React, Vue, Svelte and Angular apps, in
// app/views/components. Each carries its own styles, so apps made before
// these tylix-ui classes existed look right too.
const PROMPT_CSS = `.pwa-stack { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; max-width: calc(100vw - 2rem); pointer-events: none; }
.pwa-stack > * { pointer-events: auto; }
.pwa-toast { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1.25rem; width: 24rem; max-width: 100%; padding: 1rem 1.125rem; box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.35); animation: pwa-rise 0.2s ease-out; }
.pwa-title { margin: 0; font-size: 0.875rem; font-weight: 600; }
.pwa-text { margin: 0.125rem 0 0; font-size: 0.8125rem; color: rgb(var(--tx-muted)); }
.pwa-actions { display: flex; gap: 0.375rem; margin-left: auto; }
.pwa-pill { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; border-radius: 999px; font-size: 0.8125rem; font-weight: 500; color: rgb(var(--tx-ink)); background: rgb(var(--tx-panel)); border: 1px solid rgb(var(--tx-line)); box-shadow: var(--tx-shadow); }
.pwa-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: rgb(var(--tx-coral)); }
@keyframes pwa-rise { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .pwa-toast { animation: none; } }
.pwa-toast > div:first-child { flex: 1 1 14rem; min-width: 0; }`

const TEXT = {
  offline: 'You’re offline',
  updateTitle: 'A new version is ready',
  updateText: 'Reload to get the latest.',
  readyTitle: 'Ready to work offline',
  readyText: 'Pages you visit stay available without a connection.',
  installTitle: 'Install this app',
  installText: 'Open it from your home screen or dock, like any other app.',
}
const DISMISS_KEY = 'tylix:pwa-install-dismissed'

export function reactPrompt() {
  return `// New version, offline-ready and install prompts, bottom right. Render
// it once, in the layout: <PwaPrompt />
import { useState } from 'react'
import { usePwa } from '@tylix/pwa/react'

const CSS = \`${PROMPT_CSS}\`

function wasDismissed() {
  try {
    return localStorage.getItem('${DISMISS_KEY}') === '1'
  } catch {
    return false
  }
}

export default function PwaPrompt() {
  const pwa = usePwa()
  const [hideInstall, setHideInstall] = useState(wasDismissed)
  const dismissInstall = () => {
    setHideInstall(true)
    try {
      localStorage.setItem('${DISMISS_KEY}', '1')
    } catch {}
  }
  let toast = null
  if (pwa.updateAvailable) {
    toast = (
      <div className="tx-panel pwa-toast" role="status">
        <div><p className="pwa-title">${TEXT['updateTitle']}</p><p className="pwa-text">${TEXT['updateText']}</p></div>
        <div className="pwa-actions">
          <button className="tx-btn tx-btn-ghost tx-btn-sm" onClick={pwa.dismissUpdate}>Later</button>
          <button className="tx-btn tx-btn-primary tx-btn-sm" onClick={() => pwa.update()}>Reload</button>
        </div>
      </div>
    )
  } else if (pwa.offlineReady) {
    toast = (
      <div className="tx-panel pwa-toast" role="status">
        <div><p className="pwa-title">${TEXT['readyTitle']}</p><p className="pwa-text">${TEXT['readyText']}</p></div>
        <div className="pwa-actions"><button className="tx-btn tx-btn-ghost tx-btn-sm" onClick={pwa.dismissOfflineReady}>OK</button></div>
      </div>
    )
  } else if (pwa.installable && !hideInstall) {
    toast = (
      <div className="tx-panel pwa-toast" role="status">
        <div><p className="pwa-title">${TEXT['installTitle']}</p><p className="pwa-text">${TEXT['installText']}</p></div>
        <div className="pwa-actions">
          <button className="tx-btn tx-btn-ghost tx-btn-sm" onClick={dismissInstall}>Not now</button>
          <button className="tx-btn tx-btn-primary tx-btn-sm" onClick={() => pwa.install()}>Install</button>
        </div>
      </div>
    )
  }
  return (
    <div className="pwa-stack" aria-live="polite">
      <style>{CSS}</style>
      {!pwa.online && <div className="pwa-pill" role="status"><span className="pwa-dot" /> ${TEXT['offline']}</div>}
      {toast}
    </div>
  )
}
`
}

export function vuePrompt(ts) {
  return `<script setup${ts ? ' lang="ts"' : ''}>
// New version, offline-ready and install prompts, bottom right. Render it
// once, in App.vue: <PwaPrompt />
import { onMounted, ref } from 'vue'
import { usePwa } from '@tylix/pwa/vue'

const { state, install, update, dismissUpdate, dismissOfflineReady } = usePwa()
const hideInstall = ref(false)
onMounted(() => {
  try {
    hideInstall.value = localStorage.getItem('${DISMISS_KEY}') === '1'
  } catch {}
})
function dismissInstall() {
  hideInstall.value = true
  try {
    localStorage.setItem('${DISMISS_KEY}', '1')
  } catch {}
}
</script>

<template>
  <div class="pwa-stack" aria-live="polite">
    <div v-if="!state.online" class="pwa-pill" role="status"><span class="pwa-dot"></span> ${TEXT['offline']}</div>
    <div v-if="state.updateAvailable" class="tx-panel pwa-toast" role="status">
      <div><p class="pwa-title">${TEXT['updateTitle']}</p><p class="pwa-text">${TEXT['updateText']}</p></div>
      <div class="pwa-actions">
        <button class="tx-btn tx-btn-ghost tx-btn-sm" @click="dismissUpdate">Later</button>
        <button class="tx-btn tx-btn-primary tx-btn-sm" @click="update">Reload</button>
      </div>
    </div>
    <div v-else-if="state.offlineReady" class="tx-panel pwa-toast" role="status">
      <div><p class="pwa-title">${TEXT['readyTitle']}</p><p class="pwa-text">${TEXT['readyText']}</p></div>
      <div class="pwa-actions"><button class="tx-btn tx-btn-ghost tx-btn-sm" @click="dismissOfflineReady">OK</button></div>
    </div>
    <div v-else-if="state.installable && !hideInstall" class="tx-panel pwa-toast" role="status">
      <div><p class="pwa-title">${TEXT['installTitle']}</p><p class="pwa-text">${TEXT['installText']}</p></div>
      <div class="pwa-actions">
        <button class="tx-btn tx-btn-ghost tx-btn-sm" @click="dismissInstall">Not now</button>
        <button class="tx-btn tx-btn-primary tx-btn-sm" @click="install">Install</button>
      </div>
    </div>
  </div>
</template>

<style>
${PROMPT_CSS}
</style>
`
}

export function sveltePrompt(ts) {
  return `<script${ts ? ' lang="ts"' : ''}>
  // New version, offline-ready and install prompts, bottom right. Render
  // it once, in App.svelte: <PwaPrompt />
  import { onMount } from 'svelte'
  import { pwa } from '@tylix/pwa/svelte'

  let hideInstall = $state(false)
  onMount(() => {
    try {
      hideInstall = localStorage.getItem('${DISMISS_KEY}') === '1'
    } catch {}
  })
  function dismissInstall() {
    hideInstall = true
    try {
      localStorage.setItem('${DISMISS_KEY}', '1')
    } catch {}
  }
</script>

<div class="pwa-stack" aria-live="polite">
  {#if !$pwa.online}
    <div class="pwa-pill" role="status"><span class="pwa-dot"></span> ${TEXT['offline']}</div>
  {/if}
  {#if $pwa.updateAvailable}
    <div class="tx-panel pwa-toast" role="status">
      <div><p class="pwa-title">${TEXT['updateTitle']}</p><p class="pwa-text">${TEXT['updateText']}</p></div>
      <div class="pwa-actions">
        <button class="tx-btn tx-btn-ghost tx-btn-sm" onclick={pwa.dismissUpdate}>Later</button>
        <button class="tx-btn tx-btn-primary tx-btn-sm" onclick={pwa.update}>Reload</button>
      </div>
    </div>
  {:else if $pwa.offlineReady}
    <div class="tx-panel pwa-toast" role="status">
      <div><p class="pwa-title">${TEXT['readyTitle']}</p><p class="pwa-text">${TEXT['readyText']}</p></div>
      <div class="pwa-actions"><button class="tx-btn tx-btn-ghost tx-btn-sm" onclick={pwa.dismissOfflineReady}>OK</button></div>
    </div>
  {:else if $pwa.installable && !hideInstall}
    <div class="tx-panel pwa-toast" role="status">
      <div><p class="pwa-title">${TEXT['installTitle']}</p><p class="pwa-text">${TEXT['installText']}</p></div>
      <div class="pwa-actions">
        <button class="tx-btn tx-btn-ghost tx-btn-sm" onclick={dismissInstall}>Not now</button>
        <button class="tx-btn tx-btn-primary tx-btn-sm" onclick={pwa.install}>Install</button>
      </div>
    </div>
  {/if}
</div>

<style>
${PROMPT_CSS}
</style>
`
}

export function angularPrompt() {
  return `import { Component, signal } from '@angular/core'
import { injectPwa } from '@tylix/pwa/angular'

// New version, offline-ready and install prompts, bottom right. Render it
// once, in app.ts: <app-pwa-prompt /> (and add PwaPrompt to imports).
@Component({
  selector: 'app-pwa-prompt',
  template: \`
    <div class="pwa-stack" aria-live="polite">
      @if (!pwa.state().online) {
        <div class="pwa-pill" role="status"><span class="pwa-dot"></span> ${TEXT['offline']}</div>
      }
      @if (pwa.state().updateAvailable) {
        <div class="tx-panel pwa-toast" role="status">
          <div><p class="pwa-title">${TEXT['updateTitle']}</p><p class="pwa-text">${TEXT['updateText']}</p></div>
          <div class="pwa-actions">
            <button class="tx-btn tx-btn-ghost tx-btn-sm" (click)="pwa.dismissUpdate()">Later</button>
            <button class="tx-btn tx-btn-primary tx-btn-sm" (click)="pwa.update()">Reload</button>
          </div>
        </div>
      } @else if (pwa.state().offlineReady) {
        <div class="tx-panel pwa-toast" role="status">
          <div><p class="pwa-title">${TEXT['readyTitle']}</p><p class="pwa-text">${TEXT['readyText']}</p></div>
          <div class="pwa-actions"><button class="tx-btn tx-btn-ghost tx-btn-sm" (click)="pwa.dismissOfflineReady()">OK</button></div>
        </div>
      } @else if (pwa.state().installable && !hideInstall()) {
        <div class="tx-panel pwa-toast" role="status">
          <div><p class="pwa-title">${TEXT['installTitle']}</p><p class="pwa-text">${TEXT['installText']}</p></div>
          <div class="pwa-actions">
            <button class="tx-btn tx-btn-ghost tx-btn-sm" (click)="dismissInstall()">Not now</button>
            <button class="tx-btn tx-btn-primary tx-btn-sm" (click)="pwa.install()">Install</button>
          </div>
        </div>
      }
    </div>
  \`,
  styles: \`${PROMPT_CSS}\`,
})
export class PwaPrompt {
  protected readonly pwa = injectPwa()
  protected readonly hideInstall = signal(readDismissed())

  protected dismissInstall() {
    this.hideInstall.set(true)
    try {
      localStorage.setItem('${DISMISS_KEY}', '1')
    } catch {}
  }
}

function readDismissed() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('${DISMISS_KEY}') === '1'
  } catch {
    return false
  }
}
`
}

const HOSTED = {
  react: { file: (ts) => `PwaPrompt.${ts ? 'tsx' : 'jsx'}`, source: () => reactPrompt(), where: 'components/Layout: render <PwaPrompt /> inside the shell (import PwaPrompt from "./PwaPrompt")' },
  vue: { file: () => 'PwaPrompt.vue', source: (ts) => vuePrompt(ts), where: 'App.vue: import PwaPrompt from "./components/PwaPrompt.vue" and render <PwaPrompt />' },
  svelte: { file: () => 'PwaPrompt.svelte', source: (ts) => sveltePrompt(ts), where: 'App.svelte: import PwaPrompt from "./components/PwaPrompt.svelte" and render <PwaPrompt />' },
  angular: { file: () => 'pwa-prompt.ts', source: () => angularPrompt(), where: 'app.ts: add PwaPrompt (from "./components/pwa-prompt") to imports and <app-pwa-prompt /> to the template' },
}

function hostedFrontend(pkg) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return Object.keys(HOSTED).find((name) => deps[`@tylix/${name}`]) ?? null
}

export function patchLayout(source) {
  if (source.includes('PwaPrompt')) return source
  const lines = source.split('\n')
  let lastImport = -1
  lines.forEach((line, i) => {
    if (/^import\s/.test(line)) lastImport = i
  })
  const slot = lines.findIndex((line) => line.includes('data-tylix-slot'))
  if (lastImport === -1 || slot === -1) return null
  const indent = /^\s*/.exec(lines[slot])[0]
  lines.splice(slot + 1, 0, `${indent}<PwaPrompt />`)
  lines.splice(lastImport + 1, 0, 'import PwaPrompt from "./components/PwaPrompt"')
  return lines.join('\n')
}

export async function makePwa({ baseDir = process.cwd(), quiet = false } = {}) {
  const written = []
  const kept = []
  const notes = []
  const write = async (rel, content) => {
    const file = path.join(baseDir, rel)
    if (await exists(file)) {
      kept.push(rel)
      return
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
    written.push(rel)
  }

  const pkgFile = path.join(baseDir, 'package.json')
  const pkg = (await exists(pkgFile)) ? JSON.parse(await fs.readFile(pkgFile, 'utf-8')) : {}
  const name = titleCase(pkg.name)

  for (const icon of ['pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png']) {
    await write(path.join('public', icon), await fs.readFile(path.join(ASSETS, icon)))
  }
  await write(path.join('public', 'offline.html'), offlinePage({ name }))

  // tylix.config
  const configFile = ['tylix.config.ts', 'tylix.config.js', 'tylix.config.mjs'].map((f) => path.join(baseDir, f))
  let configured = false
  for (const file of configFile) {
    if (!(await exists(file))) continue
    const source = await fs.readFile(file, 'utf-8')
    const patched = patchConfig(source, name)
    if (patched === null) {
      notes.push(`Add this to ${path.basename(file)}:\n\n${pwaConfigBlock(name)}`)
    } else if (patched !== source) {
      await fs.writeFile(file, patched)
      written.push(`${path.basename(file)} (pwa)`)
    }
    configured = true
    break
  }
  if (!configured) notes.push(`No tylix.config found. Add:\n\n${pwaConfigBlock(name)}`)

  // Native pages: a capability and a prompt in the layout.
  if (await exists(path.join(baseDir, 'app', 'pages'))) {
    await write(path.join('app', 'capabilities', 'Pwa.tyx'), PWA_CAPABILITY)
    await write(path.join('app', 'pages', 'components', 'PwaPrompt.tyx'), PWA_PROMPT)
    const layoutFile = path.join(baseDir, 'app', 'pages', '_layout.tyx')
    if (await exists(layoutFile)) {
      const source = await fs.readFile(layoutFile, 'utf-8')
      const patched = patchLayout(source)
      if (patched === null) notes.push('Add <PwaPrompt /> (app/pages/components/PwaPrompt) to your layout.')
      else if (patched !== source) {
        await fs.writeFile(layoutFile, patched)
        written.push('app/pages/_layout.tyx (PwaPrompt)')
      }
    }
  } else {
    const framework = hostedFrontend(pkg)
    const ts = await exists(path.join(baseDir, 'tsconfig.json'))
    if (framework) {
      const target = HOSTED[framework]
      await write(path.join('app', 'views', 'components', target.file(ts)), target.source(ts))
      notes.push(`Show the prompt: in app/views/${target.where}.`)
    } else {
      notes.push('Show install and update prompts with usePwa() from @tylix/pwa/react, /vue, /svelte or injectPwa() from /angular.')
    }
  }

  if (!pkg.dependencies?.['@tylix/pwa'] && (await exists(pkgFile))) {
    pkg.dependencies = { ...(pkg.dependencies ?? {}), '@tylix/pwa': `^${cliVersion}` }
    await fs.writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
    written.push('package.json (@tylix/pwa)')
  }

  if (!quiet) {
    console.log('\n✔ Progressive web app\n')
    for (const f of written) console.log(`  + ${f}`)
    for (const f of kept) console.log(`  = ${f} (kept)`)
    for (const n of notes) console.log(`\n  ${n}`)
    console.log(
      '\nThe service worker runs in production ("tylix build" then "tylix start"); in dev it\n' +
        'removes itself so you always see fresh files (pwa.dev: true to keep it).\n' +
        'Replace the icons in public/ with your own (192px, 512px, and a maskable 512px).',
    )
  }
  return { written, kept, notes }
}
