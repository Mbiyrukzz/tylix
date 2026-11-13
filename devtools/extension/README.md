# Tylix DevTools

A Chrome and Firefox DevTools panel for native Tylix (`.tyx`) apps:

- the live page, layout and components (nested as they are on the page) and the capabilities in use
- state, props and computed values, updated as the app changes them
- edit any state field or prop as JSON (Ctrl/Cmd+Enter to save); the page re-renders
- run an action with arguments
- hover a component in the tree to highlight it on the page

## Install (unpacked)

```sh
npm run build
```

- **Chrome / Edge**: `chrome://extensions` → Developer mode → *Load unpacked* → `devtools/extension/dist`
- **Firefox**: `about:debugging` → This Firefox → *Load Temporary Add-on* → `devtools/extension/dist/manifest.json`

Open your app from `tylix dev`, open DevTools and pick the **Tylix** tab.

## How it connects

`tylix dev` puts `window.__TYLIX_DEVTOOLS_HOOK__` on every page (source: `packages/compiler/src/runtime/devtoolsHook.js`). The native runtime reports each instance and capability to it. The panel reads it with `devtools.inspectedWindow.eval`. The extension has no content scripts and asks for no site permissions. Production pages don't have the hook, so the panel shows nothing there.

The hook also works from the console without the extension:

```js
__TYLIX_DEVTOOLS_HOOK__.find('Counter')[0].count = 5
```

## Tests

`TYLIX_DEVTOOLS_APP=http://localhost:3000 npm test` drives the built panel against a running native starter app (`e2e/dev-tools.mjs` does this as part of the frontend matrix).

## Privacy

The extension collects and sends nothing. It declares no permissions and no content scripts. The panel reads state only from the page open in DevTools, and only while the panel is open.
