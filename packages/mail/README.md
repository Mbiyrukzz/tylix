# @tylix/mail

Email for Tylix apps: Mailables, an SMTP driver with STARTTLS, a log
driver for development, and a log of what was sent.

```sh
npm install @tylix/mail
```

## Sending

```js
import { Mail } from '@tylix/mail'

await Mail.send(
  { to: 'ada@example.com', subject: 'Welcome', view: 'welcome', data: { name: 'Ada' } },
  config.mail,
)
```

`view` names an HTML file in `resources/mail/`; `{{ name }}` placeholders
are filled from `data`.

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

await new WelcomeMail(user).send(user.email, config.mail)
```

`tylix make:mail Welcome` creates one.

## Drivers

Set `MAIL_DRIVER` in `.env`:

- `smtp`: sends through `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`
  (`MAIL_SECURE=true` for port 465; port 587 upgrades with STARTTLS)
- `log` (default): records mail instead of sending it. In development the
  starter shows them at `/dev/mail`, so verification and reset links work
  without a mail server.

Every mail is recorded in the `mail_logs` table (`MailLog`).

## License

MIT
