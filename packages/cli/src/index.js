#!/usr/bin/env node
import { makeModel } from './commands/makeModel.js'
import { makeMigration } from './commands/makeMigration.js'
import { makeController } from './commands/makeController.js'
import { makeFeature } from './commands/makeFeature.js'
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
import { dev } from './commands/dev.js'

const [, , command, ...rest] = process.argv

async function main() {
  if (command === 'migrate') {
    await migrate()
    return
  }

  if (command === 'dev') {
    const portArg = rest.find((a) => a.startsWith('--port='))
    const port = portArg ? Number(portArg.split('=')[1]) : 3000
    await dev({ port })
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

  if (command === 'make:component') {
    const [name] = rest
    if (!name) {
      console.error('Usage: tylix make:component <Name>')
      process.exit(1)
    }
    await makeComponent(name)
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
      `Available commands: dev, migrate, make:auth, make:page, make:component, ${Object.keys(COMMANDS).join(', ')}`,
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
