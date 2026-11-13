import { formatAddress } from '../mime.js'

// log(): prints each message instead of sending it (the default when no
// transport is configured).
export function log({ logger = console, showBody = true } = {}) {
  return {
    name: 'log',
    async send(msg) {
      const to = [...msg.to, ...msg.cc, ...msg.bcc].map(formatAddress).join(', ')
      const files = msg.attachments.length ? `\n   Attachments: ${msg.attachments.map((a) => a.filename).join(', ')}` : ''
      logger.log(`\n📧 [mail:log] To: ${to}\n   Subject: ${msg.subject}${files}${showBody ? `\n${msg.html || msg.text}` : ''}\n`)
      return { status: 'captured', id: null }
    },
  }
}

// memory(): keeps every message in `.messages` (newest last). Mostly for
// tests; see fake() for assertions.
export function memory() {
  const messages = []
  return {
    name: 'memory',
    messages,
    async send(msg) {
      messages.push(msg)
      return { status: 'captured', id: `memory-${messages.length}` }
    },
  }
}
