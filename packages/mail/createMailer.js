// The standalone mailer. Works in any Node app; nothing here needs Tylix.
//
//   import { createMailer, transports } from '@tylix/mail'
//
//   const mailer = createMailer({
//     transport: transports.resend({ apiKey: process.env.RESEND_API_KEY }),
//     from: 'Acme <hello@acme.dev>',
//     views: './emails',            // or (view, data) => ({ html, text })
//   })
//
//   await mailer.send({
//     to: 'ada@example.com',
//     subject: 'Welcome',
//     view: 'welcome', data: { name: 'Ada' },   // or html / text
//     attachments: [{ path: './invoice.pdf' }],
//   })
import { buildMime, loadAttachments, normalizeMessage } from './mime.js'
import { createViewRenderer } from './template.js'
import { log as logTransport } from './transports/dev.js'

function resolveViews(views) {
  if (typeof views === 'function') return views
  if (typeof views === 'string') return createViewRenderer(views)
  return null
}

// Mailable instances (anything with build()) become plain messages.
async function toMessage(input, to) {
  if (input && typeof input.build === 'function') {
    const built = await input.build()
    return { ...built, ...(to !== undefined ? { to } : {}) }
  }
  return to !== undefined ? { ...input, to } : input
}

export function createMailer({
  transport = logTransport(),
  from,
  replyTo,
  headers,
  views,
  onSent,
  onError,
} = {}) {
  let current = transport
  const render = resolveViews(views)

  // The message with its view rendered and defaults applied; nothing sent.
  async function prepare(input, to) {
    const message = await toMessage(input, to)
    let { html, text } = message
    if (message.view) {
      if (!render) throw new Error(`Message uses view "${message.view}" but the mailer has no \`views\` option`)
      const out = await render(message.view, message.data ?? {})
      const rendered = typeof out === 'string' ? { html: out } : out
      html = html ?? rendered.html
      text = text ?? rendered.text
    }
    const normalized = normalizeMessage(
      { ...message, html, text, headers: { ...headers, ...message.headers } },
      { from, replyTo },
    )
    normalized.attachments = await loadAttachments(normalized.attachments)
    normalized.view = message.view ?? null
    normalized.data = message.data ?? null
    return normalized
  }

  const mailer = {
    get transport() {
      return current
    },
    // Swap the transport (Mail.fake() uses this).
    useTransport(next) {
      const previous = current
      current = next
      return previous
    },

    async send(input, to) {
      const msg = await prepare(input, to)
      try {
        const result = await current.send(msg)
        const outcome = { status: result?.status ?? 'sent', id: result?.id ?? null, transport: current.name ?? 'custom', message: msg }
        await onSent?.(outcome)
        return outcome
      } catch (err) {
        await onError?.(err, { transport: current.name ?? 'custom', message: msg })
        throw err
      }
    },

    // Renders without sending: { subject, html, text, from, to, ... }.
    prepare,

    // The complete .eml text of a message, for previews and debugging.
    async preview(input, to) {
      const msg = await prepare(input, to)
      return { ...msg, raw: buildMime(msg).raw }
    },
  }
  return mailer
}

// ---------------------------------------------------------------- fakes

function matches(value, expected) {
  if (expected instanceof RegExp) return expected.test(String(value ?? ''))
  if (typeof expected === 'function') return Boolean(expected(value))
  return value === expected
}

function hasAddress(list, expected) {
  return list.some((a) => matches(a.address, expected))
}

// match: a predicate, or { to, cc, bcc, from, subject, view, html, text }
// where strings must be equal (html/text: contained) and RegExps match.
export function messageMatches(msg, match) {
  if (typeof match === 'function') return Boolean(match(msg))
  for (const [key, expected] of Object.entries(match ?? {})) {
    if (key === 'to' || key === 'cc' || key === 'bcc' || key === 'replyTo') {
      if (![].concat(expected).every((e) => hasAddress(msg[key], e))) return false
    } else if (key === 'from') {
      if (!matches(msg.from.address, expected)) return false
    } else if ((key === 'html' || key === 'text') && typeof expected === 'string') {
      if (!msg[key].includes(expected)) return false
    } else if (!matches(msg[key], expected)) {
      return false
    }
  }
  return true
}

function describe(match) {
  if (typeof match === 'function') return 'matching the predicate'
  return JSON.stringify(match, (k, v) => (v instanceof RegExp ? String(v) : v))
}

// A memory transport with assertions. Pass it to createMailer, or use
// Mail.fake() in Tylix apps.
export function createFakeTransport() {
  const sent = []
  const fake = {
    name: 'fake',
    sent,
    async send(msg) {
      sent.push(msg)
      return { status: 'captured', id: `fake-${sent.length}` }
    },
    last() {
      return sent.at(-1) ?? null
    },
    find(match) {
      return sent.filter((m) => messageMatches(m, match))
    },
    assertSent(match = {}, times) {
      const found = fake.find(match)
      if (times === undefined ? found.length === 0 : found.length !== times) {
        throw new Error(
          `Expected ${times === undefined ? 'a' : times} message(s) ${describe(match)}, found ${found.length}. Sent: ${sent.map((m) => `"${m.subject}" to ${m.to.map((a) => a.address).join(', ')}`).join('; ') || 'nothing'}`,
        )
      }
      return found
    },
    assertNotSent(match = {}) {
      const found = fake.find(match)
      if (found.length) throw new Error(`Expected no message ${describe(match)}, found ${found.length}`)
    },
    assertNothingSent() {
      if (sent.length) throw new Error(`Expected no mail, but ${sent.length} message(s) were sent`)
    },
    assertSentCount(n) {
      if (sent.length !== n) throw new Error(`Expected ${n} message(s), ${sent.length} were sent`)
    },
    clear() {
      sent.length = 0
    },
  }
  return fake
}
