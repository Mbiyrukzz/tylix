import http from 'node:http'
import { port } from './routes.mjs'

// The floor: no framework, hand-written routing.
const json = (res, body) => {
  const text = JSON.stringify(body)
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}
http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/hello') return json(res, { hello: 'world' })
    if (req.method === 'GET' && req.url.startsWith('/users/')) return json(res, { id: req.url.slice(7) })
    if (req.method === 'POST' && req.url === '/echo') {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => json(res, JSON.parse(raw)))
      return
    }
    res.statusCode = 404
    res.end()
  })
  .listen(port, () => process.send?.('ready'))
