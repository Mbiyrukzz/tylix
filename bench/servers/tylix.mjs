import { Router, Server } from '../../packages/core/src/index.js'
import { FILLER, port } from './routes.mjs'

process.env.NODE_ENV = 'production'
const router = new Router()
for (const path of FILLER) router.get(path, (req, res) => res.json({ path }))
router.get('/hello', (req, res) => res.json({ hello: 'world' }))
router.get('/users/:id', (req, res) => res.json({ id: req.params.id }))
router.post('/echo', (req, res) => res.json(req.body))
// Access log off unless TYLIX_ACCESS_LOG=true (see run.mjs).
new Server(router, { autoPort: false, accessLog: process.env.TYLIX_ACCESS_LOG === 'true' }).listen(port, () => process.send?.('ready'))

// Exit cleanly on Ctrl+C so --cpu-prof can write its profile.
process.on('SIGINT', () => process.exit(0))
