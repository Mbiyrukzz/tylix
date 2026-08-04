import net from 'node:net'
import tls from 'node:tls'

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

export class SmtpClient {
  constructor({
    host,
    port,
    secure = false,
    user,
    password,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    this.host = host
    this.port = port
    this.secure = secure
    this.user = user
    this.password = password
    this.timeoutMs = timeoutMs
  }

  async connect() {
    this.socket = await connectSocket(
      { host: this.host, port: this.port, secure: this.secure },
      this.timeoutMs,
    )
    this.reader = new SmtpResponseReader(this.socket)

    checkCode(await this.reader.read(this.timeoutMs), [220])
    writeCommand(this.socket, `EHLO ${this.host}`)
    checkCode(await this.reader.read(this.timeoutMs), [250])

    if (!this.secure && this.port === 587) {
      writeCommand(this.socket, 'STARTTLS')
      checkCode(await this.reader.read(this.timeoutMs), [220])

      this.reader.detach()
      this.socket = await new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({ socket: this.socket })
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

      writeCommand(this.socket, `EHLO ${this.host}`)
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
    try {
      await this.connect()

      writeCommand(this.socket, `MAIL FROM:<${from}>`)
      checkCode(await this.reader.read(this.timeoutMs), [250])

      const recipients = Array.isArray(to) ? to : [to]
      for (const recipient of recipients) {
        writeCommand(this.socket, `RCPT TO:<${recipient}>`)
        checkCode(await this.reader.read(this.timeoutMs), [250, 251])
      }

      writeCommand(this.socket, 'DATA')
      checkCode(await this.reader.read(this.timeoutMs), [354])

      const boundary = `tylix-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const body = [
        `From: ${from}`,
        `To: ${recipients.join(', ')}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        (text || '').replace(/^\./gm, '..'), // dot-stuffing per RFC 5321
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        (html || '').replace(/^\./gm, '..'),
        `--${boundary}--`,
        '.',
      ].join('\r\n')

      writeCommand(this.socket, body)
      checkCode(await this.reader.read(this.timeoutMs), [250])

      writeCommand(this.socket, 'QUIT')
    } finally {
      this.reader?.detach()
      this.socket?.end()
    }
  }
}
