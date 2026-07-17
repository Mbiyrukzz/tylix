#!/usr/bin/env node
import { scaffold } from './scaffold.js'

const projectName = process.argv[2]

scaffold({ projectName }).catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
