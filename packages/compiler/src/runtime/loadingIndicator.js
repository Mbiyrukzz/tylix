// Shared state for the loading indicator. The loading page (app/loading.tyx)
// receives this object as its "loading" prop. When a project has no loading
// page, a plain top bar is drawn instead, unless the project turned it off
// with loadingBar: false in tylix.config.
//
//   active    number of requests in flight
//   progress  bar width, 0 to 100
//   visible   false when nothing is loading
//
// The logic below uses plain variables and only WRITES to the reactive
// object. Reading reactive state here would subscribe whichever template
// effect happens to be running when a request starts, and creating an
// effect here would make it a child of that effect, which is torn down
// the next time the parent re-runs. The built-in bar is therefore painted
// directly.
const __tylixLoading = reactive({
  active: 0,
  progress: 0,
  visible: false,
})

let __tylixActive = 0
let __tylixProgress = 0
let __tylixVisible = false
let __tylixHideTimer = null
let __tylixResetTimer = null
let __tylixWatchdog = null
let __tylixFallbackBar = null

function __tylixGetFallbackBar() {
  if (window.__TYLIX_CUSTOM_LOADING__) return null
  if (!__tylixFallbackBar) {
    if (!document.body) return null
    const bar = document.createElement('div')
    bar.id = 'tylix-loading-bar'
    bar.setAttribute('aria-hidden', 'true')
    bar.style.cssText =
      'position:fixed;top:0;left:0;height:3px;width:0%;background:#10b981;z-index:99999;pointer-events:none;transition:width 0.2s ease,opacity 0.3s ease;opacity:0;'
    document.body.appendChild(bar)
    __tylixFallbackBar = bar
  }
  return __tylixFallbackBar
}

function __tylixApply() {
  __tylixLoading.active = __tylixActive
  __tylixLoading.progress = __tylixProgress
  __tylixLoading.visible = __tylixVisible

  const bar = __tylixGetFallbackBar()
  if (bar) {
    bar.style.opacity = __tylixVisible ? '1' : '0'
    bar.style.width = __tylixProgress + '%'
  }
}

function __tylixFinish() {
  __tylixProgress = 100
  __tylixApply()
  __tylixHideTimer = setTimeout(() => {
    if (__tylixActive > 0) return
    __tylixVisible = false
    __tylixApply()
    __tylixResetTimer = setTimeout(() => {
      if (__tylixActive === 0) {
        __tylixProgress = 0
        __tylixApply()
      }
    }, 300)
  }, 150)
}

// Safety net: a request that never settles must not leave the bar up.
function __tylixForceFinish() {
  __tylixActive = 0
  __tylixFinish()
}

export function __tylixRequestStart() {
  clearTimeout(__tylixHideTimer)
  clearTimeout(__tylixResetTimer)
  clearTimeout(__tylixWatchdog)
  __tylixActive++
  __tylixVisible = true
  __tylixProgress = 70
  __tylixWatchdog = setTimeout(__tylixForceFinish, 30000)
  __tylixApply()
}

export function __tylixRequestEnd() {
  __tylixActive = Math.max(0, __tylixActive - 1)
  if (__tylixActive > 0) return
  clearTimeout(__tylixWatchdog)
}
  __tylixFinish()