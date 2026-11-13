// Adds the "Tylix" panel to the browser's developer tools.
const api = globalThis.browser ?? globalThis.chrome
api.devtools.panels.create('Tylix', 'icons/icon-16.png', 'panel.html')
