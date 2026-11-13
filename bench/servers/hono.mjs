import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { FILLER, port } from './routes.mjs'

const app = new Hono()
for (const path of FILLER) app.get(path, (c) => c.json({ path }))
app.get('/hello', (c) => c.json({ hello: 'world' }))
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
app.post('/echo', async (c) => c.json(await c.req.json()))
serve({ fetch: app.fetch, port }, () => process.send?.('ready'))
