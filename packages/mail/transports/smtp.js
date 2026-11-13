import { SmtpClient } from '../SmtpClient.js'
import { buildMime } from '../mime.js'

// smtp({ host, port, secure, user, password, clientName, requireTLS, timeoutMs })
export function smtp(options = {}) {
  if (!options.host) throw new Error('The smtp mail transport needs `host`')
  return {
    name: 'smtp',
    async send(msg) {
      const built = buildMime(msg)
      const client = new SmtpClient({ port: 587, ...options })
      const { response } = await client.sendRaw(built)
      return { status: 'sent', id: built.messageId, response }
    },
  }
}
