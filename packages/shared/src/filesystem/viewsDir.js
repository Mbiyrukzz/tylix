import { existsSync } from 'node:fs'
import path from 'node:path'

// A hosted frontend (React, Vue, Svelte, Angular) lives in app/views.
// Projects made before 1.6 have it in app/views; that folder keeps
// working, so nothing has to move.
export const VIEWS_DIR = 'views'
export const LEGACY_VIEWS_DIR = 'frontend'

// The folder name under app/ that holds the hosted frontend: "views",
// or "frontend" when only the old folder exists.
export function viewsDirName(baseDir = process.cwd()) {
  const app = path.join(baseDir, 'app')
  if (!existsSync(path.join(app, VIEWS_DIR)) && existsSync(path.join(app, LEGACY_VIEWS_DIR))) {
    return LEGACY_VIEWS_DIR
  }
  return VIEWS_DIR
}

// Absolute path of that folder.
export function resolveViewsDir(baseDir = process.cwd()) {
  return path.join(baseDir, 'app', viewsDirName(baseDir))
}

// "app/views" (or "app/views"), for messages and hints.
export function viewsDirLabel(baseDir = process.cwd()) {
  return `app/${viewsDirName(baseDir)}`
}
