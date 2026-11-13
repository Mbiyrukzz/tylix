import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMailer, createFakeTransport, Mail, Mailable, transportFromConfig, transports } from '../index.js'

class WelcomeMail extends Mailable {
  constructor(name) {
    super()
    this.name = name
  }
  build() {
    return { subject: `Welcome ${this.name}`, view: 'welcome', data: { name: this.name }, tags: { kind: 'welcome' } }
  }
}

const views = async (view, data) => ({ html: `<p>${view}:${data.name}</p>` })

test('createMailer: defaults, views, mailables, onSent', async () => {
  const fake = createFakeTransport()
  const events = []
  const mailer = createMailer({ transport: fake, from: 'Acme <hi@acme.dev>', views, headers: { 'X-App': 'test' }, onSent: (e) => events.push(e) })
  const result = await mailer.send(new WelcomeMail('Ada'), 'ada@b.co')
  assert.equal(result.status, 'captured')
  assert.equal(result.transport, 'fake')
  const msg = fake.last()
  assert.equal(msg.from.address, 'hi@acme.dev')
  assert.equal(msg.subject, 'Welcome Ada')
  assert.equal(msg.html, '<p>welcome:Ada</p>')
  assert.equal(msg.text, 'welcome:Ada')
  assert.equal(msg.headers['X-App'], 'test')
  assert.equal(msg.view, 'welcome')
  assert.equal(events.length, 1)
})

test('a view without a renderer is an error; explicit html wins over the view', async () => {
  const fake = createFakeTransport()
  await assert.rejects(createMailer({ transport: fake, from: 'a@b.co' }).send({ to: 'c@d.co', view: 'x' }), /no `views` option/)
  await createMailer({ transport: fake, from: 'a@b.co', views }).send({ to: 'c@d.co', view: 'x', data: { name: 'n' }, html: '<b>mine</b>' })
  assert.equal(fake.last().html, '<b>mine</b>')
})

test('onError sees transport failures, which still throw', async () => {
  const errors = []
  const broken = { name: 'broken', send: async () => { throw new Error('down') } }
  const mailer = createMailer({ transport: broken, from: 'a@b.co', onError: (err) => errors.push(err.message) })
  await assert.rejects(mailer.send({ to: 'c@d.co', subject: 's', text: 't' }), /down/)
  assert.deepEqual(errors, ['down'])
})

test('preview returns the full .eml text', async () => {
  const mailer = createMailer({ from: 'a@b.co' })
  const p = await mailer.preview({ to: 'c@d.co', subject: 'Preview', html: '<p>x</p>' })
  assert.match(p.raw, /^From: a@b\.co\r\n[\s\S]*Subject: Preview/)
})

test('fake assertions', async () => {
  const fake = createFakeTransport()
  const mailer = createMailer({ transport: fake, from: 'a@b.co' })
  fake.assertNothingSent()
  await mailer.send({ to: 'ada@b.co', cc: 'boss@b.co', subject: 'Invoice #12', html: '<p>Total: 10</p>' })
  fake.assertSent({ to: 'ada@b.co', subject: /Invoice/ })
  fake.assertSent({ cc: 'boss@b.co', html: 'Total: 10' }, 1)
  fake.assertNotSent({ to: 'eve@b.co' })
  fake.assertSentCount(1)
  assert.throws(() => fake.assertSent({ subject: 'Nope' }), /found 0\. Sent: "Invoice #12" to ada@b\.co/)
  assert.throws(() => fake.assertNothingSent(), /1 message/)
})

test('Mail.fake() captures Mail.send and Mailable.send', async () => {
  const mail = Mail.fake()
  try {
    await new WelcomeMail('Ada').send('ada@b.co', { from: 'a@b.co', views })
    await Mail.send({ to: 'bob@b.co', subject: 'Hi', text: 'yo' }, { driver: 'smtp', host: 'never.used', from: 'a@b.co' })
    mail.assertSentCount(2)
    mail.assertSent({ to: 'ada@b.co', view: 'welcome' })
    mail.assertSent({ to: 'bob@b.co', text: 'yo' })
  } finally {
    Mail.restore()
  }
})

test('transportFromConfig covers every driver', () => {
  const name = (c) => transportFromConfig(c).name
  assert.equal(name({}), 'log')
  assert.equal(name({ driver: 'smtp', host: 'h' }), 'smtp')
  assert.equal(name({ driver: 'resend', apiKey: 'k' }), 'resend')
  assert.equal(name({ driver: 'sendgrid', apiKey: 'k' }), 'sendgrid')
  assert.equal(name({ driver: 'postmark', apiKey: 'k' }), 'postmark')
  assert.equal(name({ driver: 'mailgun', apiKey: 'k', domain: 'd' }), 'mailgun')
  assert.equal(name({ driver: 'ses', region: 'us-east-1', accessKeyId: 'a', secretAccessKey: 's' }), 'ses')
  assert.equal(name({ driver: 'memory' }), 'memory')
  const custom = { name: 'mine', send: async () => ({}) }
  assert.equal(transportFromConfig({ transport: custom }), custom)
  assert.throws(() => transportFromConfig({ driver: 'pigeon' }), /Unknown mail driver "pigeon"/)
  assert.throws(() => transportFromConfig({ driver: 'resend' }), /needs `apiKey`/)
})

test('log transport prints instead of sending', async () => {
  const lines = []
  const mailer = createMailer({ transport: transports.log({ logger: { log: (l) => lines.push(l) } }), from: 'a@b.co' })
  const r = await mailer.send({ to: 'c@d.co', subject: 'Logged', text: 'body', attachments: [{ filename: 'a.txt', content: 'x' }] })
  assert.equal(r.status, 'captured')
  assert.match(lines[0], /To: c@d\.co\n {3}Subject: Logged\n {3}Attachments: a\.txt\nbody/)
})

test('the mail log keeps links usable for the /dev/mail pages', async () => {
  const { MailLog } = await import('../index.js')
  const rows = []
  const saved = { available: MailLog.available, create: MailLog.create }
  MailLog.available = true
  MailLog.create = async (row) => rows.push(row)
  try {
    const resetUrl = 'http://localhost:3000/reset-password?token=abc&email=ada%40b.co'
    const result = await Mail.send(
      { to: 'ada@b.co', subject: 'Reset', view: 'reset', data: { resetUrl } },
      { driver: 'memory', from: 'a@b.co', views: async (v, d) => ({ html: (await import('../template.js')).renderTemplate('<a href="{{ resetUrl }}">Reset</a> {{ resetUrl }}', d) }) },
    )
    assert.match(result.message.html, /token=abc&amp;email=/, 'the sent HTML is escaped')
    const links = rows[0].body.match(/https?:\/\/[^\s"'<>]+/g)
    assert.deepEqual([...new Set(links)], [resetUrl], 'the logged copy has the real link')
    assert.equal(rows[0].driver, 'memory')
  } finally {
    MailLog.available = saved.available
    MailLog.create = saved.create
  }
})
