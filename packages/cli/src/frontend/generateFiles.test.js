import { test } from 'node:test'
import assert from 'node:assert/strict'
import { componentFile, insertAtMarker, pageFiles, parseName, registerRoute, routeFile } from './generateFiles.js'

test('names become identifiers, URLs and selectors', () => {
  assert.deepEqual(parseName('admin/UserSettings'), {
    folders: ['admin'],
    base: 'UserSettings',
    identifier: 'AdminUserSettings',
    routePath: '/admin/user-settings',
    selector: 'admin-user-settings',
  })
  assert.equal(parseName('reports').base, 'Reports')
  assert.equal(parseName('HTMLReport').routePath, '/html-report')
  assert.equal(parseName('admin\\Users').routePath, '/admin/users', 'Windows separators')
  for (const bad of ['', '/', '../etc', 'my-page', '1st', 'a/../b', 'a b']) {
    assert.throws(() => parseName(bad), /not a valid name/, bad)
  }
})

test('each frontend puts pages in its own format and folder', () => {
  assert.equal(pageFiles('react', 'admin/Settings').file, 'pages/admin/Settings.jsx')
  assert.equal(pageFiles('react', 'admin/Settings', { ts: true }).file, 'pages/admin/Settings.tsx')
  assert.equal(pageFiles('vue', 'admin/Settings').file, 'pages/admin/Settings.vue')
  assert.equal(pageFiles('svelte', 'admin/Settings').file, 'pages/admin/Settings.svelte')
  assert.equal(pageFiles('angular', 'admin/UserSettings').file, 'pages/admin/user-settings.ts')
  assert.match(pageFiles('vue', 'X', { ts: true }).content, /<script setup lang="ts">/)
  assert.match(pageFiles('svelte', 'X').content, /^<script>/)
  assert.match(pageFiles('angular', 'admin/UserSettings').content, /selector: 'app-admin-user-settings'[\s\S]*export class AdminUserSettings/)
})

test('route lines, with and without --auth', () => {
  assert.equal(pageFiles('react', 'admin/Settings').routeLine(false), '<Route path="admin/settings" element={<AdminSettings />} />')
  assert.match(pageFiles('react', 'Reports').routeLine(true), /<RequireAuth fallback=\{<RedirectToLogin \/>\}/)
  assert.equal(pageFiles('vue', 'Reports').routeLine(true), "{ path: '/reports', component: Reports, meta: { access: 'auth' } },")
  assert.equal(pageFiles('svelte', 'Reports').routeLine(false), "{ path: '/reports', page: Reports, access: 'any' },")
  assert.match(pageFiles('angular', 'Reports').routeLine(true), /canActivate: \[authGuard\], data: \{ access: 'auth' \}/)
  assert.equal(pageFiles('angular', 'Reports').importLine, "import { Reports } from './pages/reports'")
  assert.equal(pageFiles('vue', 'admin/Settings').importLine, "import AdminSettings from './pages/admin/Settings.vue'")
})

test('route files per frontend', () => {
  assert.equal(routeFile('react', true), 'App.tsx')
  assert.equal(routeFile('vue', false), 'router.js')
  assert.equal(routeFile('svelte', true), 'App.svelte')
  assert.equal(routeFile('angular', true), 'app.routes.ts')
})

test('lines go above the marker, with its indentation', () => {
  const source = 'a\n    // tylix:routes (x)\nb'
  assert.equal(insertAtMarker(source, 'tylix:routes', 'NEW'), 'a\n    NEW\n    // tylix:routes (x)\nb')
  assert.equal(insertAtMarker('a\nb', 'tylix:routes', 'NEW'), null)
})

test('registerRoute adds import and route, and reports what is missing', () => {
  const source = ["import Home from './pages/Home'", '// tylix:imports', 'routes:', '  // tylix:routes'].join('\n')
  const page = pageFiles('vue', 'Reports')
  const { source: out } = registerRoute(source, page)
  assert.equal(
    out,
    ["import Home from './pages/Home'", "import Reports from './pages/Reports.vue'", '// tylix:imports', 'routes:', "  { path: '/reports', component: Reports },", '  // tylix:routes'].join('\n'),
  )
  assert.match(registerRoute(out, page).conflict, /already imported/)
  assert.equal(registerRoute('no markers', page).missing, 'tylix:imports')
  assert.equal(registerRoute('// tylix:imports', page).missing, 'tylix:routes')
})

test('components in each format', () => {
  assert.equal(componentFile('react', 'ui/Card').file, 'components/ui/Card.jsx')
  assert.match(componentFile('react', 'Card', { ts: true }).content, /children\?: ReactNode/)
  assert.match(componentFile('svelte', 'Card', { ts: true }).content, /children\?: Snippet/)
  assert.match(componentFile('vue', 'Card').content, /<slot \/>/)
  assert.equal(componentFile('angular', 'StatCard').file, 'components/stat-card.ts')
  assert.match(componentFile('angular', 'StatCard').content, /<ng-content \/>/)
})
