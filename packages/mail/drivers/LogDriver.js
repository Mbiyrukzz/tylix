import { MailLog } from '../models/MailLog.js'

export class LogDriver {
  async deliver({ to, subject, html, text }) {
    const body = html || text || ''
    console.log(`\n📧 [mail:log] To: ${to}\n   Subject: ${subject}\n${body}\n`)
    await MailLog.create({
      recipient: to,
      subject,
      body,
      driver: 'log',
      status: 'captured',
    })
    return { status: 'captured' }
  }
}
