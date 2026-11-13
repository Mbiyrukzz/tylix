// Mailgun: https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages
import { addr, request, requireOption } from './http.js'

export function mailgun({ apiKey, domain, region = 'us', endpoint, fetch } = {}) {
  requireOption(apiKey, 'mailgun', 'apiKey')
  requireOption(domain, 'mailgun', 'domain')
  const base = endpoint ?? (region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net')
  return {
    name: 'mailgun',
    async send(msg) {
      const form = new FormData()
      form.append('from', addr(msg.from))
      for (const a of msg.to) form.append('to', addr(a))
      for (const a of msg.cc) form.append('cc', addr(a))
      for (const a of msg.bcc) form.append('bcc', addr(a))
      form.append('subject', msg.subject)
      if (msg.text) form.append('text', msg.text)
      if (msg.html) form.append('html', msg.html)
      if (msg.replyTo.length) form.append('h:Reply-To', msg.replyTo.map(addr).join(', '))
      for (const [k, v] of Object.entries(msg.headers)) form.append(`h:${k}`, v)
      for (const [k, v] of Object.entries(msg.tags)) {
        if (k === 'tag') form.append('o:tag', String(v))
        else form.append(`v:${k}`, String(v))
      }
      for (const a of msg.attachments) {
        // Inline images are matched by filename: <img src="cid:NAME">.
        const blob = new Blob([a.content], { type: a.contentType })
        if (a.cid) form.append('inline', blob, a.cid)
        else form.append('attachment', blob, a.filename)
      }
      const { body } = await request('Mailgun', fetch, `${base}/v3/${encodeURIComponent(domain)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
        body: form,
      })
      return { status: 'sent', id: body?.id ?? null }
    },
  }
}
