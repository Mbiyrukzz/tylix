// The Tylix server in several processes sharing the port, as
// "tylix start --workers" runs it. BENCH_WORKERS (default 2).
import cluster from 'node:cluster'
import { port } from './routes.mjs'

const count = Number(process.env.BENCH_WORKERS) || 2
if (cluster.isPrimary) {
  let ready = 0
  for (let i = 0; i < count; i++) {
    cluster.fork().on('message', () => {
      if (++ready === count) process.send?.('ready')
    })
  }
  process.on('SIGTERM', () => {
    for (const worker of Object.values(cluster.workers)) worker.kill()
    process.exit(0)
  })
} else {
  await import('./tylix.mjs')
}
