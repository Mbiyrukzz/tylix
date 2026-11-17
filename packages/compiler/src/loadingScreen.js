// The loading screen: what a visitor sees between the first byte and the
// page's first render, instead of a blank window. Native .tyx pages render
// in the browser (and wait for their `needs` capabilities), and React, Vue,
// Svelte and Angular pages do too when they aren't server-rendered.
//
// The Tylix mark's three strokes light up in turn over an indeterminate
// bar, in the app's own colours (the tylix-ui tokens, with fallbacks), in
// light and dark. It only fades in after 150ms, so fast pages never flash
// it, and leaves as soon as the page puts something in its root element.
// A page that never renders still gets rid of it after 15 seconds.
//
// Turn it off with loadingScreen: false in tylix.config.

const MARK = `<svg class="tls-mark" viewBox="0 0 552 366" aria-hidden="true" focusable="false"><path class="tls-s1" d="M0 96 74 22Q96 0 120 0H552L482 77Q462 96 436 96Z"/><path class="tls-s2" d="M34 366 148 151Q160 127 190 127H290L163 366Z"/><path class="tls-s3" d="M218 339 294 192Q304 171 334 171H442L378 264Q368 277 353 283Z"/></svg>`

const STYLE = `#tylix-loading-screen{--tls-bg:var(--tx-canvas,243 242 246);--tls-brand:var(--tx-brand,0 52 202);--tls-track:var(--tx-line,222 219 230);--tls-muted:var(--tx-muted,107 104 120);position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;background:rgb(var(--tls-bg));opacity:0;animation:tls-in .25s ease .15s forwards;transition:opacity .3s ease,visibility .3s ease}
html.dark #tylix-loading-screen{--tls-bg:var(--tx-canvas,23 22 28);--tls-brand:var(--tx-brand,53 99 255);--tls-track:var(--tx-line,52 49 61);--tls-muted:var(--tx-muted,149 146 163)}
#tylix-loading-screen.tls-done{opacity:0!important;visibility:hidden;animation:none}
#tylix-loading-screen .tls-inner{display:flex;flex-direction:column;align-items:center;gap:22px}
#tylix-loading-screen .tls-mark{width:64px;height:auto;overflow:visible}
#tylix-loading-screen .tls-mark path{fill:rgb(var(--tls-brand));opacity:.18;animation:tls-stroke 1.2s cubic-bezier(.4,0,.2,1) infinite}
#tylix-loading-screen .tls-s2{animation-delay:.15s!important}
#tylix-loading-screen .tls-s3{animation-delay:.3s!important}
#tylix-loading-screen .tls-track{position:relative;width:132px;height:3px;border-radius:3px;overflow:hidden;background:rgb(var(--tls-track))}
#tylix-loading-screen .tls-bar{position:absolute;inset:0 auto 0 0;width:40%;border-radius:3px;background:linear-gradient(90deg,rgb(var(--tls-brand)),rgb(111 224 234));animation:tls-slide 1.1s cubic-bezier(.65,0,.35,1) infinite}
#tylix-loading-screen .tls-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@keyframes tls-in{to{opacity:1}}
@keyframes tls-stroke{0%,100%{opacity:.18;transform:translateX(-6px)}35%,60%{opacity:1;transform:none}}
@keyframes tls-slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){#tylix-loading-screen .tls-mark path{animation:none;opacity:1;transform:none}#tylix-loading-screen .tls-bar{animation:none;width:100%;opacity:.5}}`

// `root` is the selector of the element the page renders into; the screen
// leaves when it has a child element. A list ("#root, #app, app-root")
// covers any of them.
export function loadingScreenHtml({ root = '#app', label = 'Loading' } = {}) {
  const selector = JSON.stringify(String(root)).replace(/</g, '\\u003c')
  const text = String(label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  return `<div id="tylix-loading-screen" role="status" aria-live="polite"><style data-tylix-loading>${STYLE}</style><div class="tls-inner">${MARK}<div class="tls-track"><div class="tls-bar"></div></div><span class="tls-sr">${text}…</span></div></div>
  <script>(function(){var s=document.getElementById("tylix-loading-screen");if(!s)return;var done=false,sel=${selector};function hide(){if(done)return;done=true;s.classList.add("tls-done");setTimeout(function(){s.remove()},350)}window.__tylixHideLoadingScreen=hide;function ready(){var r=document.querySelector(sel);return !!(r&&r.firstElementChild)}var mo=new MutationObserver(function(){if(ready()){mo.disconnect();hide()}});function watch(){if(ready())return hide();mo.observe(document.body,{childList:true,subtree:true})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watch);else watch();addEventListener("error",function(e){if(e&&e.error)hide()});setTimeout(hide,15000)})();</script>`
}

// The same mark as a small inline loader for inside a page (route guards,
// lazy sections): <div class="tx-loader">...</div>, styled by tylix-ui.css.
export const LOADER_MARK_SVG = MARK.replace('class="tls-mark"', 'class="tx-loader-mark"').replace(/tls-s/g, 'tx-loader-s')
