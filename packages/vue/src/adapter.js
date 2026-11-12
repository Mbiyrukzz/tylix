// What the Tylix CLI needs to host a Vue frontend. Runs in Node, inside
// `tylix dev`, `tylix build` and `tylix start`, never in the browser.
// Vite and the Vue plugin are imported from the project (see the React
// adapter for why).
export default {
  name: 'vue',
  label: 'Vue',
  root: 'app/frontend',

  // One Vue runtime, one router and one session in the bundle.
  dedupe: ['vue', 'vue-router', '@tylix/client', '@tylix/vue'],

  requires: ['vite', '@vitejs/plugin-vue', 'vue'],

  async vitePlugins({ importFromProject }) {
    const { default: vue } = await importFromProject('@vitejs/plugin-vue')
    // Absolute URLs in templates (<img src="/logo.png">) stay URLs: Tylix
    // serves public/ itself, so Vite must not try to bundle them. Relative
    // ones (./assets/x.png) are still bundled as usual.
    return [vue({ template: { transformAssetUrls: { includeAbsolute: false } } })]
  },

  // Server-side rendering (frontend.ssr: true): app/frontend/entry-server
  // renders pages with renderWithData from @tylix/vue/server.
  ssr: true,

  // `tylix build` in a TypeScript project. Plain tsc can't read .vue
  // files; vue-tsc can.
  typecheck: {
    bin: 'vue-tsc',
    args: (tsconfig) => ['--noEmit', '-p', tsconfig],
  },
}
