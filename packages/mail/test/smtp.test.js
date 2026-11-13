// A real SMTP conversation with a small in-process server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { createMailer, transports } from '../index.js'

function fakeSmtpServer({ authPlain = true } = {}) {
  const sessions = []
  const server = net.createServer((socket) => {
    const s = { commands: [], data: '' }
    sessions.push(s)
    let inData = false
    let buf = ''
    socket.write('220 fake ESMTP\r\n')
    socket.on('data', (chunk) => {
      buf += chunk
      while (true) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n')
          if (end === -1) return
          s.data = buf.slice(0, end)
          buf = buf.slice(end + 5)
          inData = false
          socket.write('250 2.0.0 Ok: queued as ABC\r\n')
          continue
        }
        const nl = buf.indexOf('\r\n')
        if (nl === -1) return
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        s.commands.push(line)
        if (line.startsWith('EHLO')) socket.write(`250-fake\r\n250-SIZE 1000000\r\n250 AUTH LOGIN${authPlain ? ' PLAIN' : ''}\r\n`)
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 ok\r\n')
        else if (line === 'AUTH LOGIN') socket.write('334 VXNlcm5hbWU6\r\n')
        else if (s.commands.at(-2) === 'AUTH LOGIN') socket.write('334 UGFzc3dvcmQ6\r\n')
        else if (s.commands.at(-3) === 'AUTH LOGIN') socket.write('235 ok\r\n')
        else if (line === 'DATA') {
          inData = true
          socket.write('354 go\r\n')
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n')
        } else socket.write('250 ok\r\n')
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, sessions, port: server.address().port })))
}

test('smtp: AUTH PLAIN, a RCPT for every to/cc/bcc, bcc kept out of the data', async () => {
  const { server, sessions, port } = await fakeSmtpServer()
  try {
    const mailer = createMailer({ transport: transports.smtp({ host: '127.0.0.1', port, user: 'u', password: 'p' }), from: 'a@b.co' })
    const r = await mailer.send({ to: 'x@b.co', cc: 'y@b.co', bcc: 'z@b.co', subject: 'Hi', text: '.leading dot\nline', attachments: [{ filename: 'a.txt', content: 'att' }] })
    assert.equal(r.status, 'sent')
    const s = sessions[0]
    assert.ok(s.commands.includes(`AUTH PLAIN ${Buffer.from('\0u\0p').toString('base64')}`))
    assert.deepEqual(s.commands.filter((c) => c.startsWith('RCPT')), ['RCPT TO:<x@b.co>', 'RCPT TO:<y@b.co>', 'RCPT TO:<z@b.co>'])
    assert.match(s.data, /\r\nCc: y@b\.co\r\n/)
    assert.doesNotMatch(s.data, /z@b\.co/)
    assert.match(s.data, /filename="a\.txt"/)
  } finally {
    server.close()
  }
})

test('smtp: falls back to AUTH LOGIN', async () => {
  const { server, sessions, port } = await fakeSmtpServer({ authPlain: false })
  try {
    await createMailer({ transport: transports.smtp({ host: '127.0.0.1', port, user: 'u', password: 'p' }), from: 'a@b.co' }).send({ to: 'x@b.co', subject: 's', text: 't' })
    assert.ok(sessions[0].commands.includes('AUTH LOGIN'))
  } finally {
    server.close()
  }
})

test('smtp: requireTLS refuses a server without STARTTLS', async () => {
  const { server, port } = await fakeSmtpServer()
  try {
    const mailer = createMailer({ transport: transports.smtp({ host: '127.0.0.1', port, requireTLS: true }), from: 'a@b.co' })
    await assert.rejects(mailer.send({ to: 'x@b.co', subject: 's', text: 't' }), /does not offer STARTTLS/)
  } finally {
    server.close()
  }
})
