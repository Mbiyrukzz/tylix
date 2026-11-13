// Postmark: https://postmarkapp.com/developer/api/email-api
import { addr, b64, request, requireOption } from './http.js'

export function postmark({ serverToken, messageStream, endpoint = 'https://api.postmarkapp.com', fetch } = {}) {
  requireOption(serverToken, 'postmark', 'serverToken')
  return {
    name: 'postmark',
    async send(msg) {
      const list = (xs) => (xs.length ? xs.map(addr).join(', ') : undefined)
      const payload = {
        From: addr(msg.from),
        To: list(msg.to),
        Cc: list(msg.cc),
        Bcc: list(msg.bcc),
        ReplyTo: list(msg.replyTo),
        Subject: msg.subject,
        HtmlBody: msg.html || undefined,
        TextBody: msg.text || undefined,
        MessageStream: messageStream,
      }
      if (Object.keys(msg.headers).length) {
        payload.Headers = Object.entries(msg.headers).map(([Name, Value]) => ({ Name, Value }))
      }
      if (msg.tags.tag) payload.Tag = String(msg.tags.tag)
      const metadata = Object.entries(msg.tags).filter(([k]) => k !== 'tag')
      if (metadata.length) payload.Metadata = Object.fromEntries(metadata.map(([k, v]) => [k, String(v)]))
      if (msg.attachments.length) {
        payload.Attachments = msg.attachments.map((a) => ({
          Name: a.filename,
          Content: b64(a.content),
          ContentType: a.contentType,
          ...(a.cid ? { ContentID: `cid:${a.cid}` } : {}),
        }))
      }
      const { body } = await request('Postmark', fetch, `${endpoint}/email`, {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': serverToken,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      return { status: 'sent', id: body?.MessageID ?? null }
    },
  }
}
