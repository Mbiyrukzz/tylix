# @tylix/mail

Email for any Node.js app. Send through SMTP, Resend, SendGrid, Postmark,
Mailgun or Amazon SES with one API. Includes templates, attachments,
inline images, and a fake for tests. No dependencies.

It also plugs into Tylix apps, with Mailables and a log of sent mail.

```sh
npm install @tylix/mail
```

## Quick start (any Node app)

```js
import { createMailer, transports } from '@tylix/mail'

const mailer = createMailer({
  transport: transports.resend({ apiKey: process.env.RESEND_API_KEY }),
  from: 'Acme <hello@acme.dev>',
  views: './emails', // emails/welcome.html (+ optional welcome.txt)
})

await mailer.send({
  to: 'Ada Lovelace <ada@example.com>',
  subject: 'Welcome to Acme',
  view: 'welcome',
  data: { name: 'Ada' },
})
```

## Messages

```js
await mailer.send({
  from: 'Billing <billing@acme.dev>', // overrides the mailer default
  to: ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }],
  cc: 'accounts@example.com',
  bcc: 'archive@acme.dev', // only in the envelope, never in the headers
  replyTo: 'support@acme.dev',
  subject: 'Invoice #1042',
  html: '<p>Thanks! <img src="cid:logo"></p>',
  text: 'Thanks!', // generated from html when omitted
  attachments: [
    { path: './invoices/1042.pdf' },
    { filename: 'data.csv', content: 'a,b\n1,2' },
    { filename: 'logo.png', path: './logo.png', cid: 'logo' }, // inline image
  ],
  headers: { 'X-Entity-Ref-ID': 'inv-1042' },
  tags: { tag: 'billing', customer: 42 },
})
```

The result is `{ status: 'sent', id, transport, message }`. `id` is the
provider's message id. Header injection (line breaks in addresses,
subjects or headers) is rejected before anything is sent.

## Transports

| Transport | Options |
| --- | --- |
| `transports.smtp()` | `host`, `port` (587 = STARTTLS, `secure: true` for 465), `user`, `password`, `requireTLS`, `clientName` |
| `transports.resend()` | `apiKey` |
| `transports.sendgrid()` | `apiKey` |
| `transports.postmark()` | `serverToken`, `messageStream` |
| `transports.mailgun()` | `apiKey`, `domain`, `region: 'us' \| 'eu'` |
| `transports.ses()` | `region`, `accessKeyId`, `secretAccessKey`, `sessionToken`, `configurationSet`. Defaults to the standard `AWS_*` variables. Requests are signed with SigV4, no AWS SDK needed |
| `transports.log()` | prints mail instead of sending (the default) |
| `transports.memory()` | keeps mail in `.messages` |

Provider errors throw `MailTransportError` with `.provider`, `.status`
and `.response`.

A custom transport is any object with
`send(message) → { status, id }`. It receives the normalized message
(parsed addresses, loaded attachments as Buffers).

## Templates

With `views: './emails'`, `view: 'welcome'` renders `emails/welcome.html`,
plus `emails/welcome.txt` as the text part when that file exists.

```html
<h1>Hi {{ user.name }}</h1>            <!-- escaped -->
{{{ trustedHtml }}}                     <!-- inserted as-is -->
{{#if items}}
  <ul>{{#each items}}<li>{{ @index }}. {{ title }}</li>{{/each}}</ul>
{{#else}}
  <p>Nothing yet.</p>
{{/if}}
```

A missing variable throws, so a typo never mails `undefined`. To use
another engine (MJML, React Email, Handlebars…), pass a function:
`views: async (view, data) => ({ html, text })`.

## Mailables

```js
import { Mailable } from '@tylix/mail'

export class WelcomeMail extends Mailable {
  constructor(user) {
    super()
    this.user = user
  }
  build() {
    return { subject: 'Welcome', view: 'welcome', data: { name: this.user.name } }
  }
}

await mailer.send(new WelcomeMail(user), user.email)
```

## Testing

```js
import { createMailer, createFakeTransport } from '@tylix/mail'

const fake = createFakeTransport()
const mailer = createMailer({ transport: fake, from: 'a@acme.dev', views: './emails' })

await signUp('ada@example.com') // your code, sending through `mailer`

fake.assertSent({ to: 'ada@example.com', subject: /Welcome/ })
fake.assertSent({ view: 'welcome' }, 1) // exactly once
fake.assertNotSent({ to: 'eve@example.com' })
fake.last().html // the rendered message
```

`mailer.preview(message)` returns the rendered message plus `raw`, the
complete `.eml` text.

## In Tylix apps

The starter configures mail from `.env`:

```sh
MAIL_DRIVER=resend          # log | smtp | resend | sendgrid | postmark | mailgun | ses
MAIL_FROM="Acme <hello@acme.dev>"
MAIL_API_KEY=re_...
# smtp: MAIL_HOST MAIL_PORT MAIL_USER MAIL_PASSWORD MAIL_SECURE
# mailgun: MAIL_DOMAIN MAIL_REGION   ses: MAIL_REGION + AWS_* credentials
```

```js
import { Mail } from '@tylix/mail'

await Mail.send({ to: 'ada@example.com', subject: 'Welcome', view: 'welcome', data: { name: 'Ada' } }, config.mail)
await new WelcomeMail(user).send(user.email, config.mail)
```

Views live in `resources/mail/`. Every send is recorded in the
`mail_logs` table (`MailLog`), and in development the starter shows them
at `/dev/mail`, so verification and reset links work without a mail
server. `tylix make:mail Welcome` creates a Mailable.

In tests, `Mail.fake()` captures every `Mail.send()` until
`Mail.restore()`:

```js
const mail = Mail.fake()
await request(app).post('/api/auth/register').send({ email: 'ada@example.com' })
mail.assertSent({ to: 'ada@example.com', view: 'verify-email' })
Mail.restore()
```

## License

MIT
