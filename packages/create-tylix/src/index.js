#!/usr/bin/env node
import { scaffold } from './scaffold.js'

const projectName = process.argv[2]

scaffold({ projectName })
  .then(() => {
    // The prompts leave stdin open, which keeps Node alive after a
    // successful scaffold. Exit explicitly so the command returns.
    process.exit(0)
  })
  .catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })
