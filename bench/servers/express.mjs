import express from 'express'
import { FILLER, port } from './routes.mjs'

const app = express()
app.use(express.json())
for (const path of FILLER) app.get(path, (req, res) => res.json({ path }))
app.get('/hello', (req, res) => res.json({ hello: 'world' }))
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }))
app.post('/echo', (req, res) => res.json(req.body))
app.listen(port, () => process.send?.('ready'))
