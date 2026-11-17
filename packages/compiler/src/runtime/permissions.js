// Roles and permissions in .tyx pages. The signed-in user (Auth.user)
// carries an access snapshot when the app uses @tylix/permissions:
// { roles, permissions, denied, superAdmin }. Templates check it with
//
//   {{#if can("posts.create")}} ... {{/if}}
//   {{#if hasRole("admin")}} ... {{/if}}
//   {{#if canAny(["posts.edit", "posts.publish"])}} ... {{/if}}
//
// and a page that lists `permissions` only renders for users who have all
// of them. These checks hide UI; the API routes stay guarded on the server.
//
// The matching below mirrors @tylix/permissions (src/match.js), so the
// browser and the server agree; its tests compare the two.

function __tylixPermissionMatches(grant, requested) {
  if (typeof grant !== 'string' || typeof requested !== 'string') return false
  if (grant === requested || grant === '*') return true
  const g = grant.split('.')
  const r = requested.split('.')
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]
    const last = i === g.length - 1
    if (seg === '*') {
      if (i >= r.length) return false
      if (last) return true
      if (r[i] === '') return false
      continue
    }
    if (i >= r.length) return false
    if (seg.includes(',')) {
      if (!seg.split(',').map((x) => x.trim()).includes(r[i])) return false
    } else if (seg !== r[i]) {
      return false
    }
  }
  return g.length === r.length
}

function __tylixAccess() {
  if (typeof registry === 'undefined' || !registry.has('Auth')) return null
  const user = resolveCapability('Auth').user
  return user && typeof user === 'object' && user.access ? user.access : null
}

function __tylixAllows(access, permission) {
  if (!access) return false
  if (access.superAdmin) return true
  for (const d of access.denied || []) if (__tylixPermissionMatches(d, permission)) return false
  for (const p of access.permissions || []) if (__tylixPermissionMatches(p, permission)) return true
  return false
}

const __tylixList = (value) => (Array.isArray(value) ? value : [value])

// Put on every page, layout and component instance that doesn't define a
// member of the same name (see __tylixExpose).
const __tylixPermissionHelpers = {
  can(permission) {
    const access = __tylixAccess()
    const wanted = __tylixList(permission)
    return wanted.length > 0 && wanted.every((p) => __tylixAllows(access, p))
  },
  cannot(permission) {
    return !__tylixPermissionHelpers.can(permission)
  },
  canAny(permissions) {
    const access = __tylixAccess()
    return __tylixList(permissions).some((p) => __tylixAllows(access, p))
  },
  hasRole(role) {
    const access = __tylixAccess()
    return Boolean(access) && __tylixList(role).some((r) => (access.roles || []).includes(r))
  },
}

// The page's `permissions` block. Resolves true when the page may render.
// Guests go to login (and come back); a signed-in user without them sees
// a 403 panel. `enforced` is false when the app has no roles yet
// (no app/permissions file), so the block is a no-op there.
async function __tylixPagePermitted(required, enforced) {
  if (!required.length) return true
  if (!enforced) {
    console.info(
      '[tylix] This page lists permissions (' + required.join(', ') + ') but the app has no roles yet. Run `tylix make:permissions` to enforce them.',
    )
    return true
  }
  if (typeof registry === 'undefined' || !registry.has('Auth')) {
    console.warn('[tylix] This page lists permissions, but there is no Auth capability to read the user from.')
    return false
  }
  const auth = resolveCapability('Auth')
  try {
    await auth.ready()
  } catch (err) {
    console.error('[tylix] Auth failed to load:', err)
  }
  if (!auth.user) {
    const here = window.location.pathname + window.location.search
    window.location.replace('/login?next=' + encodeURIComponent(here))
    return false
  }
  if (required.every((p) => __tylixAllows(auth.user.access, p))) return true
  __tylixShowForbidden(required)
  return false
}

function __tylixShowForbidden(required) {
  const app = document.getElementById('app')
  if (!app) return
  const panel = document.createElement('div')
  panel.setAttribute('role', 'alert')
  panel.style.cssText =
    'min-height:70vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:var(--tx-font,system-ui,sans-serif);'
  panel.innerHTML =
    '<div style="max-width:420px;text-align:center;padding:40px 32px;border-radius:var(--tx-radius,14px);' +
    'background:rgb(var(--tx-panel,255 255 255));border:1px solid rgb(var(--tx-line,222 219 230));box-shadow:var(--tx-shadow,none);">' +
    '<div style="width:44px;height:44px;margin:0 auto 18px;border-radius:12px;display:flex;align-items:center;justify-content:center;' +
    'background:rgb(var(--tx-coral,205 60 60) / 0.12);color:rgb(var(--tx-coral,205 60 60));font-weight:700;font-size:18px;">403</div>' +
    '<h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:rgb(var(--tx-ink,23 21 28));">You don’t have access to this page</h1>' +
    '<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:rgb(var(--tx-muted,107 104 120));">Ask an administrator for the permission it needs.</p>' +
    '<a href="/" style="display:inline-block;padding:9px 18px;border-radius:var(--tx-radius-sm,9px);text-decoration:none;font-size:14px;font-weight:600;' +
    'background:rgb(var(--tx-brand,0 52 202));color:rgb(var(--tx-on-brand,255 255 255));">Go home</a></div>'
  const code = document.createElement('p')
  code.style.cssText = 'margin:14px 0 0;font:12px var(--tx-mono,ui-monospace,monospace);color:rgb(var(--tx-muted,107 104 120));'
  code.textContent = 'Needs: ' + required.join(', ')
  panel.firstChild.appendChild(code)
  app.replaceChildren(panel)
}
