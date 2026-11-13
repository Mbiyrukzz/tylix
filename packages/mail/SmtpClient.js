import net from 'node:net'
import tls from 'node:tls'
import { assertNoLineBreaks, buildMime, normalizeMessage } from './mime.js'

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
    requireTLS,
  }) {
    this.requireTLS = requireTLS
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
    this.ehlo = checkCode(await this.reader.read(this.timeoutMs), [250])

    // STARTTLS on port 587 (unless requireTLS is false), or on any port
    // when requireTLS is true. Other ports stay plain, as local test
    // servers (Mailpit, MailHog) expect.
    const upgrade = this.port === 587 ? this.requireTLS !== false : this.requireTLS === true
    if (!this.secure && upgrade) {
      if (!/^250[ -]STARTTLS/im.test(this.ehlo)) {
        throw new Error(`${this.host}:${this.port} does not offer STARTTLS`)
      }
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
      this.ehlo = checkCode(await this.reader.read(this.timeoutMs), [250])
    }

    if (this.user && this.password) {
      // AUTH PLAIN when the server offers it (one round trip), else LOGIN.
      if (/AUTH[ =][^\r\n]*\bPLAIN\b/i.test(this.ehlo ?? '')) {
        const token = Buffer.from(`\0${this.user}\0${this.password}`).toString('base64')
        writeCommand(this.socket, `AUTH PLAIN ${token}`)
        checkCode(await this.reader.read(this.timeoutMs), [235])
      } else {
        writeCommand(this.socket, 'AUTH LOGIN')
        checkCode(await this.reader.read(this.timeoutMs), [334])
        writeCommand(this.socket, Buffer.from(this.user).toString('base64'))
        checkCode(await this.reader.read(this.timeoutMs), [334])
        writeCommand(this.socket, Buffer.from(this.password).toString('base64'))
        checkCode(await this.reader.read(this.timeoutMs), [235])
      }
    }
  }

  // Simple form kept for existing callers: builds the message itself.
  async send(message) {
    const msg = normalizeMessage(message)
    return this.sendRaw(buildMime(msg))
  }

  // Sends an already-built message (see mime.js buildMime) to the
  // envelope recipients: to, cc and bcc each get a RCPT TO.
  async sendRaw({ raw, envelope }) {
    assertNoLineBreaks(envelope.from, 'envelope from')
    for (const r of envelope.to) assertNoLineBreaks(r, 'envelope recipient')
    // Dot-stuffing per RFC 5321, then the terminator.
    const data = `${raw.replace(/\r\n$/, '').replace(/(^|\r\n)\./g, '$1..')}\r\n.`

    try {
      await this.connect()

      writeCommand(this.socket, `MAIL FROM:<${envelope.from}>`)
      checkCode(await this.reader.read(this.timeoutMs), [250])

      for (const recipient of envelope.to) {
        writeCommand(this.socket, `RCPT TO:<${recipient}>`)
        checkCode(await this.reader.read(this.timeoutMs), [250, 251])
      }

      writeCommand(this.socket, 'DATA')
      checkCode(await this.reader.read(this.timeoutMs), [354])

      writeCommand(this.socket, data)
      const accepted = checkCode(await this.reader.read(this.timeoutMs), [250])

      writeCommand(this.socket, 'QUIT')
      // The message is already accepted, so a missing reply is not an error.
      await this.reader.read(2000).catch(() => {})
      return { response: accepted.trim() }
    } finally {
      this.reader?.detach()
      this.socket?.end()
    }
  }
}
