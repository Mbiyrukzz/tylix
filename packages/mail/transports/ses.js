// Amazon SES (API v2, SendEmail with a raw MIME message, so
// attachments, inline images and custom headers all work):
// https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
//
// Credentials default to the standard AWS environment variables. The
// request is signed with Signature Version 4 here; no AWS SDK needed.
import crypto from 'node:crypto'
import { buildMime } from '../mime.js'
import { request, requireOption } from './http.js'

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')

// AWS SigV4 signing key: HMAC chain over date, region, service.
export function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request')
}

// Headers (including Authorization) for a signed AWS JSON request.
export function signAwsRequest({ method, url, body, region, service, accessKeyId, secretAccessKey, sessionToken, now = new Date() }) {
  const u = new URL(url)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const headers = {
    'content-type': 'application/json',
    host: u.host,
    'x-amz-date': amzDate,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  }
  const names = Object.keys(headers).sort()
  const canonical = [
    method,
    u.pathname.split('/').map((s) => encodeURIComponent(decodeURIComponent(s))).join('/'),
    u.searchParams.toString(),
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    sha256(body),
  ].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const signature = crypto
    .createHmac('sha256', signingKey(secretAccessKey, date, region, service))
    .update(toSign)
    .digest('hex')
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  }
}

export function ses({
  region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
  accessKeyId = process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken = process.env.AWS_SESSION_TOKEN,
  configurationSet,
  endpoint,
  fetch,
} = {}) {
  requireOption(region, 'ses', 'region (or AWS_REGION)')
  requireOption(accessKeyId, 'ses', 'accessKeyId (or AWS_ACCESS_KEY_ID)')
  requireOption(secretAccessKey, 'ses', 'secretAccessKey (or AWS_SECRET_ACCESS_KEY)')
  const url = `${endpoint ?? `https://email.${region}.amazonaws.com`}/v2/email/outbound-emails`
  return {
    name: 'ses',
    async send(msg) {
      const { raw } = buildMime(msg)
      const payload = {
        Content: { Raw: { Data: Buffer.from(raw).toString('base64') } },
        // Explicit destinations, so Bcc (not in the headers) is delivered.
        Destination: {
          ToAddresses: msg.to.map((a) => a.address),
          CcAddresses: msg.cc.map((a) => a.address),
          BccAddresses: msg.bcc.map((a) => a.address),
        },
      }
      if (configurationSet) payload.ConfigurationSetName = configurationSet
      const tags = Object.entries(msg.tags)
      if (tags.length) payload.EmailTags = tags.map(([Name, Value]) => ({ Name, Value: String(Value) }))
      const body = JSON.stringify(payload)
      const headers = signAwsRequest({ method: 'POST', url, body, region, service: 'ses', accessKeyId, secretAccessKey, sessionToken })
      delete headers.host // fetch sets it
      const { body: res } = await request('Amazon SES', fetch, url, { method: 'POST', headers, body })
      return { status: 'sent', id: res?.MessageId ?? null }
    },
  }
}
