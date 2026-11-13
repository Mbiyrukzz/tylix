// A reusable message. build() returns the message without `to`:
//   { subject, view?, data?, html?, text?, attachments?, cc?, ... }
//
//   await new WelcomeMail(user).send(user.email, config.mail)
//   await mailer.send(new WelcomeMail(user), user.email)   // standalone
export class Mailable {
  build() {
    throw new Error('Mailable subclasses must implement build()')
  }

  async send(to, config) {
    const { Mail } = await import('./Mailer.js')
    return Mail.send({ ...(await this.build()), to }, config)
  }
}
