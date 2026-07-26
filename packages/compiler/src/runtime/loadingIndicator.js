let activeRequests = 0
let barEl = null

function ensureBar() {
  if (barEl) return barEl
  barEl = document.createElement('div')
  barEl.id = 'tylix-loading-bar'
  barEl.style.cssText =
    'position:fixed;top:0;left:0;height:3px;width:0%;background:#10b981;z-index:99999;transition:width 0.2s ease,opacity 0.3s ease;opacity:0;'
  document.body.appendChild(barEl)
  return barEl
}

export function __tylixRequestStart() {
  activeRequests++
  const bar = ensureBar()
  bar.style.opacity = '1'
  bar.style.width = '70%'
}

export function __tylixRequestEnd() {
  activeRequests = Math.max(0, activeRequests - 1)
  if (activeRequests === 0) {
    const bar = ensureBar()
    bar.style.width = '100%'
    setTimeout(() => {
      if (activeRequests === 0) {
        bar.style.opacity = '0'
        setTimeout(() => {
          bar.style.width = '0%'
        }, 300)
      }
    }, 150)
  }
}
