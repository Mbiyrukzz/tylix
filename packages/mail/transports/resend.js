// Resend: https://resend.com/docs/api-reference/emails/send-email
import { addr, b64, request, requireOption } from './http.js'

export function resend({ apiKey, endpoint = 'https://api.resend.com', fetch } = {}) {
  requireOption(apiKey, 'resend', 'apiKey')
  return {
    name: 'resend',
    async send(msg) {
      const payload = {
        from: addr(msg.from),
        to: msg.to.map(addr),
        subject: msg.subject,
        html: msg.html || undefined,
        text: msg.text || undefined,
      }
      if (msg.cc.length) payload.cc = msg.cc.map(addr)
      if (msg.bcc.length) payload.bcc = msg.bcc.map(addr)
      if (msg.replyTo.length) payload.reply_to = msg.replyTo.map(addr)
      if (Object.keys(msg.headers).length) payload.headers = msg.headers
      if (Object.keys(msg.tags).length) {
        payload.tags = Object.entries(msg.tags).map(([name, value]) => ({ name, value: String(value) }))
      }
      if (msg.attachments.length) {
        payload.attachments = msg.attachments.map((a) => ({
          filename: a.filename,
          content: b64(a.content),
          content_type: a.contentType,
          ...(a.cid ? { content_id: a.cid } : {}),
        }))
      }
      const { body } = await request('Resend', fetch, `${endpoint}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return { status: 'sent', id: body?.id ?? null }
    },
  }
}
