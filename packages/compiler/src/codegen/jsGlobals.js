// Single source of truth for plain JS/browser globals that templates may
// use bare. Everything else (that isn't a local) is page state/props/
// capability and gets "instance." (or "this." in the virtual .ts).
//
// Intentionally NOT listed, because they are common field or capability
// names: status, name, location, history, event, open, close, print, top,
// length, parent, screen, Notification, Storage, Request, Response,
// Image, File, Event, Audio. Use window.location, window.history, etc.

export const JS_GLOBALS = new Set([
  // values
  'null',
  'true',
  'false',
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',

  // environment
  'console',
  'window',
  'document',
  'navigator',
  'performance',
  'crypto',
  'localStorage',
  'sessionStorage',
  'matchMedia',
  'getComputedStyle',
  'scrollTo',
  'scrollBy',

  // dialogs
  'alert',
  'confirm',
  'prompt',

  // timers
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'queueMicrotask',

  // network
  'fetch',
  'FormData',
  'URL',
  'URLSearchParams',
  'AbortController',
  'AbortSignal',
  'Headers',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'BroadcastChannel',
  'Worker',

  // core objects
  'Math',
  'JSON',
  'Date',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'Set',
  'Map',
  'WeakSet',
  'WeakMap',
  'WeakRef',
  'Promise',
  'RegExp',
  'Symbol',
  'BigInt',
  'Reflect',
  'Proxy',
  'Intl',
  'Atomics',

  // errors
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'AggregateError',

  // binary / files
  'Blob',
  'FileReader',
  'ArrayBuffer',
  'DataView',
  'TextEncoder',
  'TextDecoder',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',

  // DOM types
  'HTMLElement',
  'Element',
  'Node',
  'NodeList',
  'DOMParser',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'CSS',

  // functions
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'structuredClone',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
  'btoa',
  'atob',
  'reportError',
])

// Arrow params are stored as source strings ("x", "[k, v]", "{ id }",
// "...args"). This returns the names those params actually bind, so
// they can be treated as locals inside the arrow body.
export function paramNames(params) {
  return params.flatMap((p) =>
    /^[A-Za-z_$][\w$]*$/.test(p) ? [p] : (p.match(/[A-Za-z_$][\w$]*/g) ?? []),
  )
}