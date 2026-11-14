import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_ROOT = path.resolve(__dirname, '..', 'templates')

// Every frontend template is stored with a .template suffix: they hold both
// sides of each "@if ts" block, so editors must not parse them as live code.
const TEMPLATE_SUFFIX = '.template'

// Per framework: where its templates live, which files to write for which
// options, and how a template name becomes a file name in TS projects.
// Each template is written once and serves JavaScript and TypeScript
// projects; "@if ts" blocks hold the few TypeScript-only lines.
export const FRONTENDS = {
  react: {
    templateDir: 'react',
    entry: { js: 'main.jsx', ts: 'main.tsx' },
    rename: (file, isTs) => (isTs ? file.replace(/\.jsx$/, '.tsx').replace(/\.js$/, '.ts') : file),
    base: [
      'main.jsx',
      'entry-server.jsx',
      'App.jsx',
      'AppRoutes.jsx',
      'providers/AppProviders.jsx',
      'components/Layout.jsx',
      'pages/Home.jsx',
      'pages/NotFound.jsx',
      'pages/ErrorPage.jsx',
    ],
    auth: [
      'components/Redirects.jsx',
      'components/OAuthButtons.jsx',
      'pages/Login.jsx',
      'pages/Register.jsx',
      'pages/ForgotPassword.jsx',
      'pages/ResetPassword.jsx',
      'pages/Dashboard.jsx',
      'pages/DevMail.jsx',
      'providers/MailLogProvider.jsx',
      'services/mail.js',
    ],
    posts: ['pages/Posts.jsx', 'pages/PostDetail.jsx', 'providers/PostsProvider.jsx', 'services/posts.js'],
  },
  svelte: {
    templateDir: 'svelte',
    entry: { js: 'main.js', ts: 'main.ts' },
    // .svelte files keep their name; <script lang="ts"> comes from __LANG__.
    rename: (file, isTs) => (isTs ? file.replace(/\.js$/, '.ts') : file),
    base: [
      'main.js',
      'entry-server.js',
      'App.svelte',
      'components/Navbar.svelte',
      'components/PageLoading.svelte',
      'pages/Home.svelte',
      'pages/NotFound.svelte',
      'pages/ErrorPage.svelte',
    ],
    auth: [
      'lib/next.js',
      'components/OAuthButtons.svelte',
      'pages/Login.svelte',
      'pages/Register.svelte',
      'pages/ForgotPassword.svelte',
      'pages/ResetPassword.svelte',
      'pages/Dashboard.svelte',
      'pages/DevMail.svelte',
      'providers/mail.js',
      'services/mail.js',
    ],
    posts: ['pages/Posts.svelte', 'pages/PostDetail.svelte', 'providers/posts.js', 'services/posts.js'],
  },
  vue: {
    templateDir: 'vue',
    entry: { js: 'main.js', ts: 'main.ts' },
    // .vue files keep their name; <script setup lang="ts"> comes from __LANG__.
    rename: (file, isTs) => (isTs ? file.replace(/\.js$/, '.ts') : file),
    base: [
      'main.js',
      'entry-server.js',
      'router.js',
      'App.vue',
      'components/Navbar.vue',
      'pages/Home.vue',
      'pages/NotFound.vue',
      'pages/ErrorPage.vue',
    ],
    auth: [
      'lib/next.js',
      'components/OAuthButtons.vue',
      'pages/Login.vue',
      'pages/Register.vue',
      'pages/ForgotPassword.vue',
      'pages/ResetPassword.vue',
      'pages/Dashboard.vue',
      'pages/DevMail.vue',
      'providers/mail.js',
      'services/mail.js',
    ],
    posts: ['pages/Posts.vue', 'pages/PostDetail.vue', 'providers/posts.js', 'services/posts.js'],
  },
  angular: {
    templateDir: 'angular',
    // TypeScript only: the scaffolder never makes a JavaScript Angular app.
    entry: { js: 'main.ts', ts: 'main.ts' },
    rename: (file) => file,
    base: [
      'main.ts',
      'entry-server.ts',
      'app.config.ts',
      'app.routes.ts',
      'app.ts',
      'components/navbar.ts',
      'pages/home.ts',
      'pages/not-found.ts',
      'pages/error-page.ts',
    ],
    auth: [
      'components/oauth-buttons.ts',
      'pages/login.ts',
      'pages/register.ts',
      'pages/forgot-password.ts',
      'pages/reset-password.ts',
      'pages/dashboard.ts',
      'pages/dev-mail.ts',
      'providers/mail.store.ts',
      'services/mail.ts',
    ],
    posts: ['pages/posts.ts', 'pages/post-detail.ts', 'providers/posts.store.ts', 'services/posts.ts'],
  },
}

// Keeps or drops the lines between "@if flag" and "@endif" markers. A
// marker can sit in any comment style (// @if auth, {/* @if auth */}),
// and "@if !flag" inverts. Blocks nest: a line is kept only when every
// enclosing block is on. Marker lines themselves are always removed.
export function renderTemplate(source, flags) {
  const out = []
  const stack = []
  for (const line of source.split('\n')) {
    const start = line.match(/@if\s+(!?)(\w+)/)
    if (start) {
      const value = Boolean(flags[start[2]])
      stack.push(start[1] === '!' ? !value : value)
      continue
    }
    if (/@endif\b/.test(line)) {
      if (stack.length === 0) throw new Error('@endif without @if in template')
      stack.pop()
      continue
    }
    if (stack.every(Boolean)) out.push(line)
  }
  if (stack.length > 0) throw new Error('Template has an @if without @endif')
  return out.join('\n')
}

function displayName(projectName) {
  return projectName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

export async function writeFrontend(config) {
  const frontend = FRONTENDS[config.frontend]
  if (!frontend) throw new Error(`No starter templates for frontend "${config.frontend}"`)
  const templateDir = path.join(TEMPLATES_ROOT, frontend.templateDir)

  const targetDir = path.join(process.cwd(), config.projectName)
  const frontendDir = path.join(targetDir, 'app', 'frontend')
  const isTs = config.language === 'typescript'
  const flags = {
    auth: config.authEnabled,
    posts: config.authEnabled && config.starter === 'starter',
    tailwind: config.styling === 'tailwind',
    ts: isTs,
  }
  const appName = displayName(config.projectName)
  const fill = (text) =>
    text
      .replaceAll('__APP_NAME__', appName)
      .replaceAll('__ENTRY__', isTs ? frontend.entry.ts : frontend.entry.js)
      .replaceAll('<script__LANG__>', isTs ? '<script lang="ts">' : '<script>')
      .replaceAll('<script setup__LANG__>', isTs ? '<script setup lang="ts">' : '<script setup>')

  const files = [
    ...frontend.base,
    ...(flags.auth ? frontend.auth : []),
    ...(flags.posts ? frontend.posts : []),
  ]
  for (const file of files) {
    const source = await fs.readFile(path.join(templateDir, file + TEMPLATE_SUFFIX), 'utf-8')
    const outPath = path.join(frontendDir, frontend.rename(file, isTs))
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, fill(renderTemplate(source, flags)))
  }

  const html = await fs.readFile(path.join(templateDir, 'index.html' + TEMPLATE_SUFFIX), 'utf-8')
  await fs.writeFile(path.join(frontendDir, 'index.html'), fill(html))

  if (isTs) {
    for (const file of ['tsconfig.json', 'vite-env.d.ts']) {
      await fs.copyFile(path.join(templateDir, file + TEMPLATE_SUFFIX), path.join(frontendDir, file))
    }
  }
}
