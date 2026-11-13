// SendGrid: https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
import { b64, request, requireOption } from './http.js'

const person = (a) => (a.name ? { email: a.address, name: a.name } : { email: a.address })

export function sendgrid({ apiKey, endpoint = 'https://api.sendgrid.com', fetch } = {}) {
  requireOption(apiKey, 'sendgrid', 'apiKey')
  return {
    name: 'sendgrid',
    async send(msg) {
      const personalization = {}
      if (msg.to.length) personalization.to = msg.to.map(person)
      if (msg.cc.length) personalization.cc = msg.cc.map(person)
      if (msg.bcc.length) personalization.bcc = msg.bcc.map(person)
      const content = []
      if (msg.text) content.push({ type: 'text/plain', value: msg.text }) // text must come first
      if (msg.html) content.push({ type: 'text/html', value: msg.html })
      const payload = {
        personalizations: [personalization],
        from: person(msg.from),
        subject: msg.subject,
        content,
      }
      if (msg.replyTo.length) payload.reply_to_list = msg.replyTo.map(person)
      if (Object.keys(msg.headers).length) payload.headers = msg.headers
      if (Object.keys(msg.tags).length) {
        payload.custom_args = Object.fromEntries(Object.entries(msg.tags).map(([k, v]) => [k, String(v)]))
      }
      if (msg.attachments.length) {
        payload.attachments = msg.attachments.map((a) => ({
          content: b64(a.content),
          filename: a.filename,
          type: a.contentType,
          disposition: a.cid ? 'inline' : 'attachment',
          ...(a.cid ? { content_id: a.cid } : {}),
        }))
      }
      const { res } = await request('SendGrid', fetch, `${endpoint}/v3/mail/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return { status: 'sent', id: res.headers?.get?.('x-message-id') ?? null }
    },
  }
}
