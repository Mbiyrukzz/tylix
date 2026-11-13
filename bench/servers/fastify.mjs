import Fastify from 'fastify'
import { FILLER, port } from './routes.mjs'

const app = Fastify()
for (const path of FILLER) app.get(path, async () => ({ path }))
app.get('/hello', async () => ({ hello: 'world' }))
app.get('/users/:id', async (req) => ({ id: req.params.id }))
app.post('/echo', async (req) => req.body)
app.listen({ port }).then(() => process.send?.('ready'))
