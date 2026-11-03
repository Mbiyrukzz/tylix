import fs from 'node:fs/promises'
import path from 'node:path'

// Public, read-only post endpoints plus the authenticated image upload.
// The owner-scoped CRUD stays at /api/posts behind requireAuth
// (registered by the Post feature). Overwrites the empty routes() stub
// written by createProjectStructure.
export async function writePublicPostRoutes(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const source = isTs
    ? `import { requireAuth } from '@tylix/core'
import type { Router } from '@tylix/core'
import { PostController } from '../controllers/PostController.js'
import { UploadController } from '../controllers/UploadController.js'

export async function routes(router: Router) {
  const posts = new PostController()
  const uploads = new UploadController()

  // Public, read-only. Owner-scoped CRUD stays at /api/posts behind requireAuth.
  router.get('/api/public/posts', (req: any, res: any) => posts.publicIndex(req, res))
  router.get('/api/public/posts/:id', (req: any, res: any) => posts.publicShow(req, res))

  // Logged-in users only.
  router.post(
    '/api/uploads',
    requireAuth((req: any, res: any) => uploads.store(req, res), process.env.AUTH_SECRET),
  )
}
`
    : `import { requireAuth } from '@tylix/core'
import { PostController } from '../controllers/PostController.js'
import { UploadController } from '../controllers/UploadController.js'

export async function routes(router) {
  const posts = new PostController()
  const uploads = new UploadController()

  // Public, read-only. Owner-scoped CRUD stays at /api/posts behind requireAuth.
  router.get('/api/public/posts', (req, res) => posts.publicIndex(req, res))
  router.get('/api/public/posts/:id', (req, res) => posts.publicShow(req, res))

  // Logged-in users only.
  router.post(
    '/api/uploads',
    requireAuth((req, res) => uploads.store(req, res), process.env.AUTH_SECRET),
  )
}
`

  await fs.writeFile(path.join(targetDir, 'app', 'routes', `web.${ext}`), source)
}