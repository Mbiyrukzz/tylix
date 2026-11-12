// What the Tylix CLI needs to host a Svelte frontend. Runs in Node, inside
// `tylix dev`, `tylix build` and `tylix start`, never in the browser.
// Vite and the Svelte plugin are imported from the project (see the React
// adapter for why).
export default {
  name: 'svelte',
  label: 'Svelte',
  root: 'app/frontend',

  // One Svelte runtime and one session in the bundle.
  dedupe: ['svelte', '@tylix/client', '@tylix/svelte'],

  requires: ['vite', '@sveltejs/vite-plugin-svelte', 'svelte'],

  async vitePlugins({ importFromProject }) {
    const { svelte } = await importFromProject('@sveltejs/vite-plugin-svelte')
    // No svelte.config.js lookup: the defaults are what the starter uses,
    // and the plugin would otherwise log that the file is missing.
    return [svelte({ configFile: false })]
  },

  // Server-side rendering (frontend.ssr: true): app/frontend/entry-server
  // renders pages with renderWithData from @tylix/svelte/server.
  ssr: true,

  // `tylix build` in a TypeScript project. Plain tsc can't read .svelte
  // files; svelte-check can.
  typecheck: {
    bin: 'svelte-check',
    args: (tsconfig) => ['--tsconfig', tsconfig, '--threshold', 'error', '--output', 'human'],
  },
}
