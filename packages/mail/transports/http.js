// Shared by the HTTP API transports.
import { formatAddress } from '../mime.js'

export class MailTransportError extends Error {
  constructor(provider, status, body) {
    const detail =
      (body && typeof body === 'object' && (body.message || body.Message || body.errors?.[0]?.message || body.error)) ||
      (typeof body === 'string' ? body.slice(0, 300) : '')
    super(`${provider} rejected the message (HTTP ${status})${detail ? `: ${detail}` : ''}`)
    this.name = 'MailTransportError'
    this.provider = provider
    this.status = status
    this.response = body
  }
}

export function requireOption(value, provider, name) {
  if (!value) throw new Error(`The ${provider} mail transport needs \`${name}\``)
  return value
}

export async function request(provider, fetchImpl, url, init) {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error(`The ${provider} mail transport needs fetch (Node 18+)`)
  const res = await doFetch(url, init)
  const raw = await res.text()
  let body = raw
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {}
  if (!res.ok) throw new MailTransportError(provider, res.status, body)
  return { res, body }
}

export const addr = (a) => formatAddress(a)
export const b64 = (buf) => Buffer.from(buf).toString('base64')
