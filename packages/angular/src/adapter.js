import path from 'node:path'

// What the Tylix CLI needs to host an Angular frontend. Runs in Node,
// inside `tylix dev`, `tylix build` and `tylix start`, never in the
// browser. Angular is compiled by AnalogJS's Vite plugin, so it runs in the
// same Vite host as React, Svelte and Vue (no separate Angular CLI server).
export default {
  name: 'angular',
  label: 'Angular',
  root: 'app/frontend',

  // One Angular runtime (core, router, ...) and one session in the bundle.
  dedupe: [
    '@angular/core',
    '@angular/common',
    '@angular/router',
    '@angular/forms',
    '@angular/platform-browser',
    // Imported by @tylix/angular/server: without this, a linked @tylix/angular
    // would load it (and through it a second @angular/core) from its own
    // location, and server rendering fails with NG0201.
    '@angular/platform-server',
    '@angular/compiler',
    'rxjs',
    '@tylix/client',
    '@tylix/angular',
  ],

  requires: ['vite', '@analogjs/vite-plugin-angular', '@angular/build', '@angular/compiler-cli', '@angular/core'],

  async vitePlugins({ importFromProject, root }) {
    const { default: angular } = await importFromProject('@analogjs/vite-plugin-angular')
    // liveReload: Angular's component HMR, so template and style edits
    // apply in place in `tylix dev` instead of reloading the page.
    return angular({ tsconfig: path.join(root, 'tsconfig.json'), liveReload: true })
  },

  // Bundle Angular into the server build too. Its npm packages are only
  // partially compiled; the Vite plugin's linker finishes them when they're
  // bundled. Left external, Node would load them unlinked, and they fail
  // without the JIT compiler. The same goes for any Angular component
  // library, like tylix-icons/angular; add others to frontend.vite in
  // tylix.config (ssr.noExternal).
  viteConfig: {
    ssr: { noExternal: [/^@angular\//, /^tylix-icons\/angular/] },
  },

  // Server-side rendering (frontend.ssr: true): app/frontend/entry-server
  // renders pages with renderWithData from @tylix/angular/server.
  ssr: true,
  // Angular's server output includes <app-root> itself, so its outlet
  // replaces that element in index.html; this puts it back when a page is
  // not server-rendered.
  ssrFallback: '<app-root></app-root>',

  // `tylix build`: ngc checks templates too, which plain tsc can't.
  // --noEmit here, not in the tsconfig: the Vite plugin compiles through
  // that same tsconfig, and noEmit there makes it produce an empty bundle.
  typecheck: {
    bin: 'ngc',
    args: (tsconfig) => ['-p', tsconfig, '--noEmit'],
  },
}
