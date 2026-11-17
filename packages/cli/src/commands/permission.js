import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { detectLanguage, exists } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'

// tylix permission:* — manage roles from the terminal, against the app's
// database and its app/permissions instance.
//
//   permission:create-role <name> [permission ...] [--inherits a,b] [--description "..."]
//   permission:create-permission <name ...> [--description "..."]
//   permission:assign <role> <user id or email> [--team t] [--expires 2027-01-01]
//   permission:revoke <role> <user id or email> [--team t]
//   permission:show [user id or email]
//   permission:sync           the definition in app/permissions (like db:seed)

async function loadApp(baseDir) {
  const ext = (await detectLanguage(baseDir)) === 'typescript' ? 'ts' : 'js'
  const file = path.join(baseDir, 'app', `permissions.${ext}`)
  if (!(await exists(file))) {
    throw new Error('This app has no roles yet. Run "tylix make:permissions" first.')
  }
  await bootstrapDatabase(baseDir)
  const mod = await import(pathToFileURL(file).href)
  if (!mod.permissions) throw new Error(`app/permissions.${ext} must export \`permissions\`.`)
  return { permissions: mod.permissions, definition: mod.definition, ext }
}

async function findUser(baseDir, ext, who) {
  const file = path.join(baseDir, 'app', 'models', `User.${ext}`)
  if (!(await exists(file))) return { id: who, label: who }
  const { User } = await import(pathToFileURL(file).href)
  const row = String(who).includes('@')
    ? await User.where('email', String(who).trim().toLowerCase()).first()
    : await User.find(who)
  if (!row) throw new Error(`No user with ${String(who).includes('@') ? 'email' : 'id'} ${who}.`)
  return { id: row.id, label: row.email ?? row.name ?? String(row.id) }
}

function flag(args, name) {
  const inline = args.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : undefined
}

function positional(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!args[i].includes('=') && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) i++
      continue
    }
    out.push(args[i])
  }
  return out
}

const USAGE = {
  'permission:create-role': 'tylix permission:create-role <name> [permission ...] [--inherits a,b] [--description "..."]',
  'permission:create-permission': 'tylix permission:create-permission <name ...> [--description "..."]',
  'permission:assign': 'tylix permission:assign <role> <user id or email> [--team t] [--expires 2027-01-01]',
  'permission:revoke': 'tylix permission:revoke <role> <user id or email> [--team t]',
  'permission:show': 'tylix permission:show [user id or email]',
  'permission:sync': 'tylix permission:sync',
}

export const PERMISSION_COMMANDS = Object.keys(USAGE)

export async function permissionCommand(command, args, baseDir = process.cwd()) {
  const [first, ...more] = positional(args)
  const usage = () => {
    throw new Error(`Usage: ${USAGE[command]}`)
  }
  const { permissions, definition, ext } = await loadApp(baseDir)

  switch (command) {
    case 'permission:create-role': {
      if (!first) usage()
      const inherits = flag(args, 'inherits')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
      const role = await permissions.createRole(first, { permissions: more, inherits, description: flag(args, 'description') ?? null })
      console.log(`✔ Role ${role.name} created${role.permissions.length ? ` with ${role.permissions.join(', ')}` : ''}${inherits.length ? `, inheriting ${inherits.join(', ')}` : ''}.`)
      return
    }
    case 'permission:create-permission': {
      if (!first) usage()
      for (const name of [first, ...more]) {
        await permissions.createPermission(name, { description: flag(args, 'description') ?? null })
        console.log(`✔ Permission ${name} created.`)
      }
      return
    }
    case 'permission:assign':
    case 'permission:revoke': {
      const [role, who] = [first, more[0]]
      if (!role || !who) usage()
      const user = await findUser(baseDir, ext, who)
      const team = flag(args, 'team') ?? null
      if (command === 'permission:assign') {
        const expires = flag(args, 'expires')
        await permissions.for(user.id).assignRole(role, { team, expiresAt: expires ? new Date(expires) : null })
        console.log(`✔ ${user.label} now has ${role}${team ? ` in team ${team}` : ''}${expires ? ` until ${expires}` : ''}.`)
      } else {
        await permissions.for(user.id).removeRole(role, { team })
        console.log(`✔ ${role} removed from ${user.label}${team ? ` in team ${team}` : ''}.`)
      }
      return
    }
    case 'permission:show': {
      if (first) {
        const user = await findUser(baseDir, ext, first)
        const access = await permissions.access(user.id)
        console.log(`\n${user.label}${access.superAdmin ? '  (super admin: every permission)' : ''}`)
        console.log(`  roles:   ${access.roles.join(', ') || '—'}`)
        console.log(`  allowed: ${access.permissions.join(', ') || '—'}`)
        if (access.denied.length) console.log(`  denied:  ${access.denied.join(', ')}`)
        console.log('')
        return
      }
      await printMatrix(await permissions.catalog(), permissions, baseDir)
      return
    }
    case 'permission:sync': {
      if (!definition) throw new Error('app/permissions exports no `definition` to sync.')
      const catalog = await permissions.sync(definition)
      console.log(`✔ Synced ${catalog.roles.length} roles and ${catalog.permissions.length} permissions.`)
      return
    }
    default:
      usage()
  }
}

// Roles across, permissions down: ✔ allowed (directly or inherited),
// ✘ denied, · not granted.
async function printMatrix(catalog, permissions, baseDir) {
  const roles = catalog.roles
  if (roles.length === 0) {
    console.log('No roles yet. Run "tylix permission:sync" or create one with permission:create-role.')
    return
  }
  const accessByRole = new Map()
  for (const r of roles) accessByRole.set(r.name, await permissions.role(r.name).access())
  // The app's own copy, so the CLI needs no dependency of its own.
  const clientPath = createRequire(path.join(baseDir, 'package.json')).resolve('@tylix/permissions/client')
  const { can, matches } = await import(pathToFileURL(clientPath).href)
  const names = catalog.permissions.map((p) => p.name)
  const width = Math.max(10, ...names.map((n) => n.length)) + 2
  const cols = roles.map((r) => Math.max(r.name.length, 3) + 2)
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(width) : c.padStart(Math.ceil(cols[i - 1] / 2) + 1).padEnd(cols[i - 1]))).join('')
  console.log('')
  console.log(''.padEnd(width) + roles.map((r, i) => r.name.padEnd(cols[i])).join(''))
  for (const name of names) {
    console.log(
      line([
        name,
        ...roles.map((r) => {
          const access = accessByRole.get(r.name)
          if (can(access, name)) return '✔'
          return access.denied.some((d) => matches(d, name)) ? '✘' : '·'
        }),
      ]),
    )
  }
  const inherit = roles.filter((r) => r.inherits.length)
  if (inherit.length) {
    console.log('')
    for (const r of inherit) console.log(`  ${r.name} inherits ${r.inherits.join(', ')}`)
  }
  console.log('')
}
