// What the Tylix CLI needs to host a React frontend. This file runs in
// Node, inside `tylix dev`, `tylix build` and `tylix start`, never in the
// browser.
//
// Vite and @vitejs/plugin-react are imported from the project
// (importFromProject), not from here: they are the project's own
// dependencies, and importing them from this package could load a second
// copy when the package is linked from elsewhere.
export default {
  name: 'react',
  label: 'React',

  // Folder that holds index.html and the React source, relative to the
  // project root.
  root: 'app/frontend',

  // Modules that must exist once in the browser bundle. Two Reacts break
  // hooks; two @tylix/client copies would mean two separate sessions.
  dedupe: ['react', 'react-dom', 'react-router', '@tylix/client', '@tylix/react'],

  // Packages the project must have installed for this frontend to run.
  requires: ['vite', '@vitejs/plugin-react', 'react', 'react-dom'],

  async vitePlugins({ importFromProject }) {
    const { default: react } = await importFromProject('@vitejs/plugin-react')
    return [react()]
  },

  // Server-side rendering (frontend.ssr: true): app/frontend/entry-server
  // renders pages with renderWithData from @tylix/react/server.
  ssr: true,

  // `tylix build` in a TypeScript project.
  typecheck: {
    bin: 'tsc',
    args: (tsconfig) => ['--noEmit', '-p', tsconfig],
  },
}
