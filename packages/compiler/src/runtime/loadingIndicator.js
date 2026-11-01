// Shared state for the loading indicator. The loading page (app/loading.tyx)
// receives this object as its "loading" prop. When a project has no loading
// page, a plain top bar is drawn from the same state instead.
//
//   active    number of requests in flight
//   progress  bar width, 0 to 100
//   visible   false when nothing is loading
const __tylixLoading = reactive({
  active: 0,
  progress: 0,
  visible: false,
})

let __tylixHideTimer = null
let __tylixResetTimer = null
let __tylixFallbackBar = null

function __tylixEnsureFallbackBar() {
  if (__tylixFallbackBar || window.__TYLIX_CUSTOM_LOADING__) return
  const bar = document.createElement('div')
  bar.id = 'tylix-loading-bar'
  bar.style.cssText =
    'position:fixed;top:0;left:0;height:3px;width:0%;background:#10b981;z-index:99999;transition:width 0.2s ease,opacity 0.3s ease;opacity:0;'
  document.body.appendChild(bar)
  effect(() => {
    bar.style.opacity = __tylixLoading.visible ? '1' : '0'
    bar.style.width = __tylixLoading.progress + '%'
  })
  __tylixFallbackBar = bar
}

export function __tylixRequestStart() {
  clearTimeout(__tylixHideTimer)
  clearTimeout(__tylixResetTimer)
  __tylixEnsureFallbackBar()
  __tylixLoading.active++
  __tylixLoading.visible = true
  __tylixLoading.progress = 70
}

export function __tylixRequestEnd() {
  __tylixLoading.active = Math.max(0, __tylixLoading.active - 1)
  if (__tylixLoading.active > 0) return

  __tylixLoading.progress = 100
  __tylixHideTimer = setTimeout(() => {
    if (__tylixLoading.active > 0) return
    __tylixLoading.visible = false
    __tylixResetTimer = setTimeout(() => {
      if (__tylixLoading.active === 0) __tylixLoading.progress = 0
    }, 300)
  }, 150)
}