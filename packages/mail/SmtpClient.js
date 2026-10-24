import net from 'node:net'
import tls from 'node:tls'
import crypto from 'node:crypto'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Buffers raw socket bytes and yields complete SMTP responses.
 * A single response can span multiple `data` events (partial line),
 * and can itself be multi-line (continuation lines use "250-", the
 * final line uses "250 "). This waits for both conditions before
 * resolving.
 */
class SmtpResponseReader {
  constructor(socket) {
    this.socket = socket
    this.buffer = ''
    this.pending = []
    this.onData = (chunk) => {
      this.buffer += chunk.toString('utf-8')
      this.flush()
    }
    this.onError = (err) => {
      this.rejectAll(err)
    }
    socket.on('data', this.onData)
    socket.on('error', this.onError)
  }

  flush() {
    while (true) {
      const lines = this.buffer.split('\r\n')
      // Keep the last (possibly incomplete) fragment in the buffer.
      const complete = lines.slice(0, -1)
      if (complete.length === 0) return

      // Find the first fully-formed response: consecutive lines
      // sharing a 3-digit code, where "CODE-" continues and "CODE "
      // ends the response.
      let consumedLines = 0
      let done = false
      for (const line of complete) {
        consumedLines++
        if (/^\d{3} /.test(line)) {
          done = true
          break
        }
        if (!/^\d{3}-/.test(line)) {
          // Malformed line — bail and let the caller see the raw text.
          done = true
          break
        }
      }

      if (!done) return // waiting for more data to complete this response

      const responseLines = complete.slice(0, consumedLines)
      this.buffer = [...complete.slice(consumedLines), lines.at(-1)].join(
        '\r\n',
      )

      const waiter = this.pending.shift()
      if (waiter) waiter.resolve(responseLines.join('\r\n'))
      if (this.pending.length === 0) return
    }
  }

  read(timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pending.indexOf(entry)
        if (idx !== -1) this.pending.splice(idx, 1)
        reject(new Error(`SMTP response timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const entry = {
        resolve: (line) => {
          clearTimeout(timer)
          resolve(line)
        },
        reject,
      }
      this.pending.push(entry)
      this.flush()
    })
  }

  rejectAll(err) {
    for (const waiter of this.pending) waiter.reject(err)
    this.pending = []
  }

  detach() {
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
  }
}

function writeCommand(socket, command) {
  socket.write(`${command}\r\n`)
}

function checkCode(response, expected) {
  const code = Number(response.slice(0, 3))
  if (!expected.includes(code)) {
    throw new Error(
      `SMTP error: expected ${expected.join('/')}, got: ${response.trim()}`,
    )
  }
  return response
}

function connectSocket(options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tls.connect({ host: options.host, port: options.port })
      : net.connect({ host: options.host, port: options.port })

    const timer = setTimeout(() => {
      socket.destroy()
      reject(
        new Error(`Connection to ${options.host}:${options.port} timed out`),
      )
    }, timeoutMs)

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// --- Message building helpers -------------------------------------------

// Any CR or LF in a header value would let the caller add headers of
// their own (or extra SMTP commands, for the envelope addresses).
function assertNoLineBreaks(value, label) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}: line breaks are not allowed`)
  }
  return value
}

// Envelope and header addresses must be a plain "user@host". This is
// also what MAIL FROM:<...> / RCPT TO:<...> require.
function assertAddress(value, label) {
  assertNoLineBreaks(value, label)
  if (!value.includes('@') || /[<>\s]/.test(value)) {
    throw new Error(`Invalid ${label}: expected a plain email address`)
  }
  return value
}

// RFC 2047: non-ASCII header text is sent as encoded words. Each word
// stays under the 75-character limit, and multi-byte characters are
// never split across words.
function encodeHeaderValue(value) {
  assertNoLineBreaks(value, 'header value')
  if (/^[\x20-\x7e]*$/.test(value)) return value

  const words = []
  let chunk = ''
  let bytes = 0
  for (const ch of value) {
    const size = Buffer.byteLength(ch)
    if (bytes + size > 45) {
      words.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += ch
    bytes += size
  }
  if (chunk) words.push(chunk)

  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`)
    .join('\r\n ')
}

// Base64 body parts need no line-ending normalisation or dot-stuffing:
// the encoded text only has A-Z a-z 0-9 + / = and is wrapped at 76.
function base64Lines(value) {
  const encoded = Buffer.from(value, 'utf-8').toString('base64')
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n')
}

// Rough plain-text fallback so the text/plain part is never empty.
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildMessage({ from, recipients, subject, html, text }) {
  const boundary = `tylix-${crypto.randomBytes(12).toString('hex')}`
  const domain = from.split('@')[1]
  // RFC 5322 date, with a numeric zone instead of "GMT".
  const date = new Date().toUTCString().replace('GMT', '+0000')

  const plain = text || htmlToText(html || '')

  const message = [
    `From: ${from}`,
    `To: ${recipients.join(', ')}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(plain),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html || ''),
    `--${boundary}--`,
  ].join('\r\n')

  // Dot-stuffing per RFC 5321, then the terminator. Nothing in the
  // message above can start a line with "." today, but this keeps it
  // safe if a part is ever sent unencoded.
  return `${message.replace(/(^|\r\n)\./g, '$1..')}\r\n.`
}

// --- Client ----------------------------------------------------------------

export class SmtpClient {
  constructor({
    host,
    port,
    secure = false,
    user,
    password,
    // Name announced in EHLO. Must identify THIS machine or app, not the
    // server, which some servers reject. "localhost" is accepted by
    // nearly all of them; set it to your app's hostname for production.
    clientName = 'localhost',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    this.host = host
    this.port = port
    this.secure = secure
    this.user = user
    this.password = password
    this.clientName = clientName
    this.timeoutMs = timeoutMs
  }

  async connect() {
    this.socket = await connectSocket(
      { host: this.host, port: this.port, secure: this.secure },
      this.timeoutMs,
    )
    this.reader = new SmtpResponseReader(this.socket)

    checkCode(await this.reader.read(this.timeoutMs), [220])
    writeCommand(this.socket, `EHLO ${this.clientName}`)
    checkCode(await this.reader.read(this.timeoutMs), [250])

    if (!this.secure && this.port === 587) {
      writeCommand(this.socket, 'STARTTLS')
      checkCode(await this.reader.read(this.timeoutMs), [220])

      this.reader.detach()
      this.socket = await new Promise((resolve, reject) => {
        // servername is needed so the certificate is checked against
        // the real host name (and so SNI is sent).
        const tlsSocket = tls.connect({
          socket: this.socket,
          servername: this.host,
        })
        const timer = setTimeout(() => {
          tlsSocket.destroy()
          reject(new Error('STARTTLS upgrade timed out'))
        }, this.timeoutMs)
        tlsSocket.once('secureConnect', () => {
          clearTimeout(timer)
          resolve(tlsSocket)
        })
        tlsSocket.once('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
      this.reader = new SmtpResponseReader(this.socket)

      writeCommand(this.socket, `EHLO ${this.clientName}`)
      checkCode(await this.reader.read(this.timeoutMs), [250])
    }

    if (this.user && this.password) {
      writeCommand(this.socket, 'AUTH LOGIN')
      checkCode(await this.reader.read(this.timeoutMs), [334])
      writeCommand(this.socket, Buffer.from(this.user).toString('base64'))
      checkCode(await this.reader.read(this.timeoutMs), [334])
      writeCommand(this.socket, Buffer.from(this.password).toString('base64'))
      checkCode(await this.reader.read(this.timeoutMs), [235])
    }
  }

  async send({ from, to, subject, html, text }) {
    // Validate everything before opening a connection.
    assertAddress(from, 'from address')
    const recipients = (Array.isArray(to) ? to : [to]).map((r) =>
      assertAddress(r, 'recipient address'),
    )
    assertNoLineBreaks(subject ?? '', 'subject')

    const message = buildMessage({
      from,
      recipients,
      subject: subject ?? '',
      html,
      text,
    })

    try {
      await this.connect()

      writeCommand(this.socket, `MAIL FROM:<${from}>`)
      checkCode(await this.reader.read(this.timeoutMs), [250])

      for (const recipient of recipients) {
        writeCommand(this.socket, `RCPT TO:<${recipient}>`)
        checkCode(await this.reader.read(this.timeoutMs), [250, 251])
      }

      writeCommand(this.socket, 'DATA')
      checkCode(await this.reader.read(this.timeoutMs), [354])

      writeCommand(this.socket, message)
      checkCode(await this.reader.read(this.timeoutMs), [250])

      writeCommand(this.socket, 'QUIT')
      // Give the server a moment to acknowledge before the socket closes.
      // The message is already accepted, so a missing reply is not an error.
      await this.reader.read(2000).catch(() => {})
    } finally {
      this.reader?.detach()
      this.socket?.end()
    }
  }
}