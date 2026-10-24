#!/usr/bin/env node
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { makeModel } from './commands/makeModel.js'
import { makeCapability } from './commands/makeCapability.js'
import { listFeatures } from './commands/listFeatures.js'
import { makeMigration } from './commands/makeMigration.js'
import { makeController } from './commands/makeController.js'
import { makeValidator } from './commands/makeValidator.js'
import { makeFeature } from './commands/makeFeature.js'
import { removeFeature } from './commands/removeFeature.js'
import { makeAuth } from './commands/makeAuth.js'
import { makePage } from './commands/makePage.js'
import { makeComponent } from './commands/makeComponent.js'
import { scheduleWork } from './commands/scheduleWork.js'
import { channelsWork } from './commands/channelsWork.js'
import { queueWork } from './commands/queueWork.js'
import { makeChannel } from './commands/makeChannel.js'
import { fieldAdd } from './commands/fieldAdd.js'
import { fieldRemove } from './commands/fieldRemove.js'
import { tinker } from './commands/tinker.js'
import { doctor } from './commands/doctor.js'
import { dbSeed } from './commands/dbSeed.js'
import { migrate } from './commands/migrate.js'
import { makeIcon } from './commands/makeIcon.js'
import { makeService } from './commands/makeService.js'
import { makeMail } from './commands/makeMail.js'
import { makeApi } from './commands/makeApi.js'
import { dev } from './commands/dev.js'
import { build } from './commands/build.js'
import { start } from './commands/start.js'

const projectRoot = process.cwd()
if (existsSync(path.join(projectRoot, 'tsconfig.json'))) {
  const requireFromProject = createRequire(
    path.join(projectRoot, 'package.json'),
  )
  const tsxApiPath = requireFromProject.resolve('tsx/esm/api')
  const { register } = await import(pathToFileURL(tsxApiPath).href)
  register()
}

const [, , command, ...rest] = process.argv

// Reads "--name=value" or "--name value". Returns undefined if absent.
function flagValue(args, name) {
  const inline = args.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)

  const i = args.indexOf(`--${name}`)
  if (i !== -1 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
    return args[i + 1]
  }
  return undefined
}

// Returns a valid port number, or undefined so the command can fall
// back to PORT from .env.
function portFlag(args) {
  const raw = flagValue(args, 'port')
  if (raw === undefined) return undefined
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid --port "${raw}"`)
    process.exit(1)
  }
  return port
}

// Arguments that are not flags (and not the value of a "--flag value" pair).
function positionalArgs(args, valueFlags) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      if (valueFlags.includes(arg.slice(2)) && !arg.includes('=')) i++
      continue
    }
    out.push(arg)
  }
  return out
}

async function main() {
  if (command === 'migrate') {
    await migrate()
    return
  }

   if (command === 'dev') {
    await dev({ port: portFlag(rest) })
    return
  }

  if (command === 'build') {
    await build()
    return
  }

  if (command === 'start') {
    await start({ port: portFlag(rest) })
    return
  }

  if (command === 'list:features') {
    await listFeatures()
    return
  }

  if (command === 'db:seed') {
    await dbSeed()
    return
  }

  if (command === 'make:icon') {
    const [name, ...pathParts] = rest
    const pathData = pathParts.join(' ')
    if (!name || !pathData) {
      console.error('Usage: tylix make:icon <Name> "<svg path d attribute>"')
      process.exit(1)
    }
    await makeIcon(name, pathData)
    return
  }

  if (command === 'make:capability') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:capability <Name>')
      process.exit(1)
    }
    await makeCapability(name)
    return
  }

  if (command === 'tinker') {
    await tinker()
    return
  }

  if (command === 'doctor') {
    await doctor()
    return
  }

  if (command === 'field:add') {
    const [featureName, ...fieldArgs] = rest
    await fieldAdd(featureName, fieldArgs)
    return
  }

  if (command === 'field:remove') {
    const [featureName, ...fieldNames] = rest
    await fieldRemove(featureName, fieldNames)
    return
  }

  if (command === 'schedule:work') {
    await scheduleWork()
    return
  }

  if (command === 'queue:work') {
    await queueWork()
    return
  }

  if (command === 'channels:work') {
    await channelsWork()
    return
  }

  if (command === 'make:service') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:service <Name>')
      process.exit(1)
    }
    await makeService(name)
    return
  }

  if (command === 'make:mail') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:mail <Name>')
      process.exit(1)
    }
    await makeMail(name)
    return
  }

  if (command === 'make:api') {
    const [name] = positionalArgs(rest, ['method', 'path'])
    if (!name) {
      console.error(
        'Usage: tylix make:api <name> [--method=get|post|put|delete] [--path=/api/...] [--public]',
      )
      process.exit(1)
    }
    await makeApi(name, {
      method: flagValue(rest, 'method'),
      path: flagValue(rest, 'path'),
      public: rest.includes('--public'),
    })
    return
  }

  if (command === 'make:channel') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:channel <name>')
      process.exit(1)
    }
    await makeChannel(name)
    return
  }

  if (command === 'make:auth') {
    await makeAuth()
    return
  }

  if (command === 'make:page') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:page <Name>')
      process.exit(1)
    }
    await makePage(name)
    return
  }

  if (command === 'make:validator') {
    const [name, ...fieldArgs] = rest
    if (!name) {
      console.error('Usage: tylix make:validator <Name> [field:type ...]')
      process.exit(1)
    }
    await makeValidator(name, fieldArgs)
    return
  }

  if (command === 'make:component') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:component <Name>')
      process.exit(1)
    }
    await makeComponent(name)
    return
  }

  if (command === 'remove:feature') {
    const yes = rest.includes('--yes') || rest.includes('-y')
    const [name] = rest.filter((a) => a !== '--yes' && a !== '-y')
    if (!name) {
      console.error('Usage: tylix remove:feature <Name> [--yes]')
      process.exit(1)
    }
    await removeFeature(name, { yes })
    return
  }
  // --dashboard is a flag, not a field:type argument -- pull it out
  // before splitting subject/fields so it doesn't get misparsed as a
  // field definition by makeFeature's field-arg loop.
  const dashboard = rest.includes('--dashboard')
  const positional = rest.filter((a) => a !== '--dashboard')

  const [subject, ...fieldArgs] = positional
  const COMMANDS = {
    'make:model': makeModel,
    'make:migration': makeMigration,
    'make:controller': makeController,
    'make:feature': makeFeature,
  }

  const handler = COMMANDS[command]
  if (!handler) {
    console.error(`Unknown command: ${command}`)
    console.error(
      `Available commands: dev, build, start, migrate, db:seed, make:auth, make:page, make:capability, make:component, make:validator, make:service, make:mail, make:api, make:channel, make:icon, field:add, field:remove, schedule:work, queue:work, channels:work, tinker, doctor, remove:feature, list:features, ${Object.keys(COMMANDS).join(', ')}`,
    )
    process.exit(1)
  }

  if (!subject) {
    console.error(`Usage: tylix ${command} <Name> [field:type ...]`)
    process.exit(1)
  }

  if (command === 'make:feature') {
    await handler(subject, fieldArgs, { dashboard })
  } else {
    await handler(subject, fieldArgs)
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})