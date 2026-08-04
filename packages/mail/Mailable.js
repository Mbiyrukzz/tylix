export class Mailable {
  build() {
    throw new Error('Mailable subclasses must implement build()')
  }

  async send(to, config) {
    const { subject, view, data } = this.build()
    const { Mail } = await import('./Mailer.js')
    return Mail.send({ to, subject, view, data }, config)
  }
}
