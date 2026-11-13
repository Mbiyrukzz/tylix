// Mail: the Tylix-app API, built on createMailer().
//
//   await Mail.send({ to, subject, view, data }, config.mail)
//
// `config.mail.driver` picks the transport: log (default), smtp, resend,
// sendgrid, postmark, mailgun, ses or memory. Every send is recorded in
// the mail_logs table when @tylix/orm is installed (the /dev/mail page
// reads it); without it, mail still sends.
import path from 'node:path'
import { createMailer, createFakeTransport } from './createMailer.js'
import * as transports from './transports/index.js'
import { MailLog } from './models/MailLog.js'

// A transport for config.mail. config.transport (an object with send())
// wins over config.driver.
export function transportFromConfig(config = {}) {
  if (config.transport && typeof config.transport.send === 'function') return config.transport
  switch (config.driver ?? 'log') {
    case 'smtp':
      return transports.smtp({
        host: config.host,
        port: Number(config.port) || 587,
        secure: config.secure,
        user: config.user,
        password: config.password,
        clientName: config.clientName,
        requireTLS: config.requireTLS,
      })
    case 'resend':
      return transports.resend({ apiKey: config.apiKey })
    case 'sendgrid':
      return transports.sendgrid({ apiKey: config.apiKey })
    case 'postmark':
      return transports.postmark({ serverToken: config.serverToken ?? config.apiKey, messageStream: config.messageStream })
    case 'mailgun':
      return transports.mailgun({ apiKey: config.apiKey, domain: config.domain, region: config.region })
    case 'ses':
      return transports.ses({
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
        configurationSet: config.configurationSet,
      })
    case 'memory':
      return transports.memory()
    case 'log':
      return transports.log()
    default:
      throw new Error(
        `Unknown mail driver "${config.driver}". Use log, smtp, resend, sendgrid, postmark, mailgun, ses or memory.`,
      )
  }
}

// A logging failure (for example the mail_logs table not existing yet)
// must never change the outcome of the send itself.
async function record(entry) {
  if (!MailLog.available) return
  try {
    await MailLog.create(entry)
  } catch (logErr) {
    console.error('[mail] could not write mail log:', logErr.message)
  }
}

const recipients = (msg) => [...msg.to, ...msg.cc, ...msg.bcc].map((a) => a.address).join(', ')

// The body kept in mail_logs. Templates escape "&" as "&amp;" (right
// for the mail that is sent), but the /dev/mail pages pick links out of
// this text with a regex, so a reset link with "&email=" would lose its
// email. The log keeps "&" plain, as it always did.
const logBody = (msg) => (msg.html || msg.text || '').replace(/&amp;/g, '&')

let fakeTransport = null

export function mailerFromConfig(config = {}) {
  return createMailer({
    transport: fakeTransport ?? transportFromConfig(config),
    from: config.from,
    replyTo: config.replyTo,
    views: config.views ?? path.join(process.cwd(), 'resources', 'mail'),
    onSent: fakeTransport
      ? undefined
      : ({ status, transport, message }) =>
          record({ recipient: recipients(message), subject: message.subject, body: logBody(message), driver: transport, status }),
    onError: fakeTransport
      ? undefined
      : (err, { transport, message }) =>
          record({ recipient: recipients(message), subject: message.subject, body: logBody(message), driver: transport, status: 'failed', error: err.message }),
  })
}

export class Mail {
  // message: { to, cc?, bcc?, from?, replyTo?, subject, view?, data?,
  //            html?, text?, attachments?, headers?, tags? }
  // or a Mailable instance.
  static async send(message, config = {}) {
    return mailerFromConfig(config).send(message)
  }

  // Renders a message (view included) without sending it.
  static async preview(message, config = {}) {
    return mailerFromConfig(config).preview(message)
  }

  // In tests: every Mail.send() is captured instead of delivered.
  //   const mail = Mail.fake()
  //   ...
  //   mail.assertSent({ to: 'ada@example.com', subject: /Welcome/ })
  //   Mail.restore()
  static fake() {
    fakeTransport = createFakeTransport()
    return fakeTransport
  }

  static restore() {
    fakeTransport = null
  }
}
