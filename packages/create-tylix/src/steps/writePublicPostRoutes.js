import fs from 'node:fs/promises'
import path from 'node:path'

// Public, read-only post endpoints plus the authenticated image upload.
// The owner-scoped CRUD stays at /api/posts behind requireAuth
// (registered by the Post feature). Overwrites the empty web file
// written by createProjectStructure.
//
// publicRoutes: open to everyone.
// protectedRoutes: the framework wraps every route in requireAuth.
export async function writePublicPostRoutes(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const source = isTs
    ? `import type { Router } from '@tylix/core'
import { PostController } from '../controllers/PostController.js'
import { UploadController } from '../controllers/UploadController.js'

// Public routes: no login needed.
export async function publicRoutes(router: Router) {
  const posts = new PostController()

  router.get('/api/public/posts', (req, res) => posts.publicIndex(req, res))
  router.get('/api/public/posts/:id', (req, res) => posts.publicShow(req, res))
}

// Protected routes: every route here requires a logged-in user.
export async function protectedRoutes(router: Router) {
  const uploads = new UploadController()

  router.post('/api/uploads', (req, res) => uploads.store(req, res))
}
`
    : `import { PostController } from '../controllers/PostController.js'
import { UploadController } from '../controllers/UploadController.js'

// Public routes: no login needed.
export async function publicRoutes(router) {
  const posts = new PostController()

  router.get('/api/public/posts', (req, res) => posts.publicIndex(req, res))
  router.get('/api/public/posts/:id', (req, res) => posts.publicShow(req, res))
}

// Protected routes: every route here requires a logged-in user.
export async function protectedRoutes(router) {
  const uploads = new UploadController()

  router.post('/api/uploads', (req, res) => uploads.store(req, res))
}
`

  await fs.writeFile(path.join(targetDir, 'app', 'routes', `web.${ext}`), source)
}