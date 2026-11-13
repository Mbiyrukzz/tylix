import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMailer, transports, MailTransportError } from '../index.js'
import { signingKey } from '../transports/ses.js'

// A fetch that records the request and answers with `reply`.
function fakeFetch(reply = { status: 200, body: {} , headers: {} }) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: reply.status < 300,
      status: reply.status,
      headers: { get: (k) => reply.headers?.[k.toLowerCase()] ?? null },
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
    }
  }
  fn.calls = calls
  return fn
}

const MESSAGE = {
  from: 'Acme <hi@acme.dev>',
  to: ['ada@b.co'],
  cc: 'carl@b.co',
  bcc: 'dee@b.co',
  replyTo: 'help@acme.dev',
  subject: 'Invoice',
  html: '<p>Total</p>',
  headers: { 'X-Entity': 'inv-1' },
  tags: { tag: 'billing', customer: 7 },
  attachments: [
    { filename: 'inv.pdf', content: Buffer.from('PDF') },
    { filename: 'logo.png', content: Buffer.from([1]), cid: 'logo' },
  ],
}

const send = (transport) => createMailer({ transport }).send(MESSAGE)
const json = (call) => JSON.parse(call.init.body)

test('resend', async () => {
  const fetch = fakeFetch({ status: 200, body: { id: 're_1' } })
  const r = await send(transports.resend({ apiKey: 'k', fetch }))
  assert.equal(r.id, 're_1')
  const [call] = fetch.calls
  assert.equal(call.url, 'https://api.resend.com/emails')
  assert.equal(call.init.headers.Authorization, 'Bearer k')
  const p = json(call)
  assert.deepEqual([p.from, p.to, p.cc, p.bcc, p.reply_to], ['Acme <hi@acme.dev>', ['ada@b.co'], ['carl@b.co'], ['dee@b.co'], ['help@acme.dev']])
  assert.equal(p.text, 'Total')
  assert.deepEqual(p.headers, { 'X-Entity': 'inv-1' })
  assert.deepEqual(p.tags, [{ name: 'tag', value: 'billing' }, { name: 'customer', value: '7' }])
  assert.deepEqual(p.attachments[0], { filename: 'inv.pdf', content: 'UERG', content_type: 'application/pdf' })
  assert.equal(p.attachments[1].content_id, 'logo')
})

test('sendgrid', async () => {
  const fetch = fakeFetch({ status: 202, body: '', headers: { 'x-message-id': 'sg_1' } })
  const r = await send(transports.sendgrid({ apiKey: 'k', fetch }))
  assert.equal(r.id, 'sg_1')
  const p = json(fetch.calls[0])
  assert.equal(fetch.calls[0].url, 'https://api.sendgrid.com/v3/mail/send')
  assert.deepEqual(p.personalizations, [{ to: [{ email: 'ada@b.co' }], cc: [{ email: 'carl@b.co' }], bcc: [{ email: 'dee@b.co' }] }])
  assert.deepEqual(p.from, { email: 'hi@acme.dev', name: 'Acme' })
  assert.deepEqual(p.content.map((c) => c.type), ['text/plain', 'text/html'])
  assert.deepEqual(p.reply_to_list, [{ email: 'help@acme.dev' }])
  assert.equal(p.attachments[1].disposition, 'inline')
  assert.deepEqual(p.custom_args, { tag: 'billing', customer: '7' })
})

test('postmark', async () => {
  const fetch = fakeFetch({ status: 200, body: { MessageID: 'pm_1', ErrorCode: 0 } })
  const r = await send(transports.postmark({ serverToken: 't', messageStream: 'outbound', fetch }))
  assert.equal(r.id, 'pm_1')
  const call = fetch.calls[0]
  assert.equal(call.init.headers['X-Postmark-Server-Token'], 't')
  const p = json(call)
  assert.deepEqual([p.To, p.Cc, p.Bcc, p.ReplyTo, p.Tag, p.MessageStream], ['ada@b.co', 'carl@b.co', 'dee@b.co', 'help@acme.dev', 'billing', 'outbound'])
  assert.deepEqual(p.Metadata, { customer: '7' })
  assert.deepEqual(p.Headers, [{ Name: 'X-Entity', Value: 'inv-1' }])
  assert.equal(p.Attachments[1].ContentID, 'cid:logo')
})

test('mailgun (EU region, multipart form)', async () => {
  const fetch = fakeFetch({ status: 200, body: { id: '<mg_1@acme.dev>', message: 'Queued' } })
  const r = await send(transports.mailgun({ apiKey: 'k', domain: 'mg.acme.dev', region: 'eu', fetch }))
  assert.equal(r.id, '<mg_1@acme.dev>')
  const call = fetch.calls[0]
  assert.equal(call.url, 'https://api.eu.mailgun.net/v3/mg.acme.dev/messages')
  assert.equal(call.init.headers.Authorization, `Basic ${Buffer.from('api:k').toString('base64')}`)
  const form = call.init.body
  assert.deepEqual([form.get('to'), form.get('cc'), form.get('bcc'), form.get('h:Reply-To'), form.get('h:X-Entity'), form.get('o:tag'), form.get('v:customer')], ['ada@b.co', 'carl@b.co', 'dee@b.co', 'help@acme.dev', 'inv-1', 'billing', '7'])
  assert.equal(form.get('attachment').name, 'inv.pdf')
  assert.equal(form.get('inline').name, 'logo')
})

test('ses: raw MIME, explicit destinations, signed request', async () => {
  const fetch = fakeFetch({ status: 200, body: { MessageId: 'ses_1' } })
  const r = await send(transports.ses({ region: 'eu-west-1', accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN', configurationSet: 'main', fetch }))
  assert.equal(r.id, 'ses_1')
  const call = fetch.calls[0]
  assert.equal(call.url, 'https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails')
  assert.match(call.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/)
  assert.equal(call.init.headers['x-amz-security-token'], 'TOKEN')
  const p = json(call)
  assert.deepEqual(p.Destination, { ToAddresses: ['ada@b.co'], CcAddresses: ['carl@b.co'], BccAddresses: ['dee@b.co'] })
  assert.equal(p.ConfigurationSetName, 'main')
  const raw = Buffer.from(p.Content.Raw.Data, 'base64').toString()
  assert.match(raw, /Subject: Invoice/)
  assert.doesNotMatch(raw, /dee@b\.co/)
})

test('ses signing key matches the AWS documentation example', () => {
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
  const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam')
  assert.equal(key.toString('hex'), 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d')
})

test('provider errors become MailTransportError with the provider message', async () => {
  const fetch = fakeFetch({ status: 422, body: { message: 'The from domain is not verified' } })
  const err = await send(transports.resend({ apiKey: 'k', fetch })).catch((e) => e)
  assert.ok(err instanceof MailTransportError)
  assert.equal(err.status, 422)
  assert.match(err.message, /Resend rejected the message \(HTTP 422\): The from domain is not verified/)
})
