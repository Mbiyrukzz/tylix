import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMime, loadAttachments, normalizeMessage, parseAddress, htmlToText } from '../mime.js'

const decode = (raw, marker) => {
  // body of the first base64 part following `marker`
  const at = raw.indexOf(marker)
  const body = raw.slice(raw.indexOf('\r\n\r\n', at) + 4).split('\r\n--')[0]
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')
}

test('addresses: plain, named, objects; invalid ones throw', () => {
  assert.deepEqual(parseAddress('a@b.co'), { name: '', address: 'a@b.co' })
  assert.deepEqual(parseAddress('Ada Lovelace <ada@b.co>'), { name: 'Ada Lovelace', address: 'ada@b.co' })
  assert.deepEqual(parseAddress('"Lovelace, Ada" <ada@b.co>'), { name: 'Lovelace, Ada', address: 'ada@b.co' })
  assert.deepEqual(parseAddress({ name: 'Ada', address: 'ada@b.co' }), { name: 'Ada', address: 'ada@b.co' })
  assert.throws(() => parseAddress('not-an-email'), /not an email address/)
  assert.throws(() => parseAddress('a@b.co\r\nBcc: evil@x.co'), /line breaks/)
})

test('header injection through subject or custom headers is refused', () => {
  const base = { from: 'a@b.co', to: 'c@d.co' }
  assert.throws(() => normalizeMessage({ ...base, subject: 'Hi\r\nBcc: x@y.co' }), /line breaks/)
  assert.throws(() => normalizeMessage({ ...base, headers: { 'X-A': 'a\nb' } }), /line breaks/)
  assert.throws(() => normalizeMessage({ ...base, headers: { 'Bad Name': 'x' } }), /Invalid header name/)
  assert.throws(() => normalizeMessage({ from: 'a@b.co' }), /at least one recipient/)
})

test('cc and reply-to are headers; bcc is only in the envelope', () => {
  const msg = normalizeMessage({
    from: 'Shop <shop@acme.dev>',
    to: ['ada@b.co', 'Bob <bob@b.co>'],
    cc: 'carl@b.co',
    bcc: ['dee@b.co'],
    replyTo: 'support@acme.dev',
    subject: 'Order',
    html: '<p>Hi</p>',
  })
  const { raw, envelope } = buildMime(msg)
  assert.match(raw, /^From: Shop <shop@acme\.dev>\r\n/)
  assert.match(raw, /\r\nTo: ada@b\.co, Bob <bob@b\.co>\r\n/)
  assert.match(raw, /\r\nCc: carl@b\.co\r\n/)
  assert.match(raw, /\r\nReply-To: support@acme\.dev\r\n/)
  assert.doesNotMatch(raw, /dee@b\.co/)
  assert.deepEqual(envelope, { from: 'shop@acme.dev', to: ['ada@b.co', 'bob@b.co', 'carl@b.co', 'dee@b.co'] })
})

test('html gets a generated text part; non-ASCII subject is encoded', () => {
  const msg = normalizeMessage({ from: 'a@b.co', to: 'c@d.co', subject: 'Café ☕', html: '<h1>Hello</h1><p>See <a href="https://x.dev">docs</a></p>' })
  const { raw } = buildMime(msg)
  assert.match(raw, /Subject: =\?UTF-8\?B\?/)
  assert.match(raw, /multipart\/alternative/)
  assert.equal(decode(raw, 'text/plain'), 'Hello\nSee docs (https://x.dev)')
  assert.equal(decode(raw, 'text/html'), '<h1>Hello</h1><p>See <a href="https://x.dev">docs</a></p>')
})

test('attachments: mixed for files, related for inline images', async () => {
  const msg = normalizeMessage({
    from: 'a@b.co',
    to: 'c@d.co',
    subject: 'Invoice',
    html: '<img src="cid:logo">',
    attachments: [
      { filename: 'invoice.pdf', content: Buffer.from('%PDF-1') },
      { filename: 'logo.png', content: Buffer.from([1, 2, 3]), cid: 'logo' },
      { filename: 'résumé.txt', content: 'hi' },
    ],
  })
  msg.attachments = await loadAttachments(msg.attachments)
  const { raw } = buildMime(msg)
  const mixed = raw.indexOf('multipart/mixed')
  const related = raw.indexOf('multipart/related')
  const alternative = raw.indexOf('multipart/alternative')
  assert.ok(mixed > -1 && mixed < related && related < alternative, 'nesting order')
  assert.match(raw, /Content-Type: application\/pdf; name="invoice\.pdf"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="invoice\.pdf"/)
  assert.match(raw, /Content-Disposition: inline; filename="logo\.png"\r\nContent-ID: <logo>/)
  assert.match(raw, /filename\*=UTF-8''r%C3%A9sum%C3%A9\.txt/)
  assert.match(raw, new RegExp(Buffer.from('%PDF-1').toString('base64')))
})

test('attachments can be read from disk', async () => {
  const [a] = await loadAttachments([{ path: new URL('../package.json', import.meta.url).pathname }])
  assert.equal(a.filename, 'package.json')
  assert.equal(a.contentType, 'application/json')
  assert.ok(a.content.length > 0)
  await assert.rejects(loadAttachments([{ filename: 'x' }]), /needs content or path/)
})

test('htmlToText', () => {
  assert.equal(htmlToText('<ul><li>One</li><li>Two &amp; three</li></ul>'), '- One\n- Two & three')
})
