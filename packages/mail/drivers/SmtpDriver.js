import { SmtpClient } from '../SmtpClient.js'

export class SmtpDriver {
  constructor(config) {
    this.config = config
  }

  async deliver({ to, subject, html, text }) {
    const client = new SmtpClient({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      user: this.config.user,
      password: this.config.password,
    })
    await client.send({ from: this.config.from, to, subject, html, text })
    return { status: 'sent' }
  }
}
