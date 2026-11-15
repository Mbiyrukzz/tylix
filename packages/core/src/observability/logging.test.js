import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from './logger.js'
import { configureLogging, dailyLogPath, flushLogFiles, formatLogLine, Log, logFiles } from './logging.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-log-'))
const read = (file) => fs.readFileSync(file, 'utf8')

test('formatLogLine: Laravel-style line, context, extras and stack trace', () => {
  const err = new Error('boom')
  const line = formatLogLine(
    { time: new Date(2026, 10, 15, 9, 5, 3), level: 'error', message: 'Charge failed', fields: { orderId: 7, requestId: 'r1', error: err } },
    'production',
  )
  assert.match(line, /^\[2026-11-15 09:05:03\] production\.ERROR: Charge failed \{"orderId":7,"error":\{"name":"Error","message":"boom"/)
  assert.match(line, / \{"requestId":"r1"\}\n\[stacktrace\]\nError: boom/)
  const bare = formatLogLine({ time: new Date(), level: 'info', message: 'Hi', fields: {} })
  assert.match(bare, /local\.INFO: Hi \[\] \[\]\n$/)
})

test('single and daily channels write files; levels filter per channel', () => {
  const dir = tmp()
  configureLogging(
    {
      default: 'stack',
      channels: {
        stack: { driver: 'stack', channels: ['single', 'daily', 'errors'] },
        errors: { driver: 'single', path: 'storage/logs/errors.log', level: 'error' },
      },
    },
    { baseDir: dir, environment: 'testing' },
  )
  Log.info('Hello', { a: 1 })
  Log.error('Bad')
  Log.critical('Worse')
  flushLogFiles()

  const single = read(path.join(dir, 'storage/logs/tylix.log'))
  assert.match(single, /testing\.INFO: Hello \{"a":1\}/)
  assert.match(single, /testing\.CRITICAL: Worse/)
  const daily = read(dailyLogPath(path.join(dir, 'storage/logs/tylix.log')))
  assert.equal(daily, single)
  const errors = read(path.join(dir, 'storage/logs/errors.log'))
  assert.doesNotMatch(errors, /Hello/)
  assert.match(errors, /ERROR: Bad/)
  assert.ok(logFiles().some((f) => f.channel === 'errors'))
  configureLogging({ default: 'null' })
})

test('Log.channel, Log.stack, Log.build, withContext and custom drivers', () => {
  const dir = tmp()
  const seen = []
  Log.extend('memory', (config) => ({ write: (entry) => seen.push([config.tag, entry.level, entry.message, entry.fields]) }))
  configureLogging(
    {
      default: 'null',
      channels: {
        a: { driver: 'memory', tag: 'a' },
        b: { driver: 'custom', via: () => (entry) => seen.push(['b', entry.level, entry.message, entry.fields]) },
      },
    },
    { baseDir: dir },
  )
  Log.info('nowhere')
  Log.channel('a').warning('to a')
  Log.stack(['a', 'b']).notice('to both')
  Log.withContext({ tenant: 3 })
  Log.channel('b').alert('with context', { x: 1 })
  Log.withoutContext()
  Log.build({ driver: 'single', path: 'one-off.log' }).emergency('built')
  flushLogFiles()

  assert.deepEqual(
    seen.map(([tag, level, message]) => [tag, level, message]),
    [
      ['a', 'warn', 'to a'],
      ['a', 'notice', 'to both'],
      ['b', 'notice', 'to both'],
      ['b', 'alert', 'with context'],
    ],
  )
  assert.deepEqual(seen[3][3], { tenant: 3, x: 1 })
  assert.match(read(path.join(dir, 'one-off.log')), /EMERGENCY: built/)
  assert.throws(() => Log.channel('missing'), /Log channel "missing" is not defined/)
  assert.throws(() => configureLogging({ default: 'x', channels: { x: { driver: 'nope' } } }), /unknown driver "nope"/)
  configureLogging({ default: 'null' })
})

test('daily channel deletes files older than `days`', () => {
  const dir = tmp()
  const logs = path.join(dir, 'storage/logs')
  fs.mkdirSync(logs, { recursive: true })
  fs.writeFileSync(path.join(logs, 'tylix-2000-01-01.log'), 'old\n')
  fs.writeFileSync(path.join(logs, 'other-2000-01-01.log'), 'keep\n')
  configureLogging({ default: 'daily', channels: { daily: { driver: 'daily', days: 3 } } }, { baseDir: dir })
  Log.info('today')
  flushLogFiles()
  assert.equal(fs.existsSync(path.join(logs, 'tylix-2000-01-01.log')), false)
  assert.equal(fs.existsSync(path.join(logs, 'other-2000-01-01.log')), true)
  configureLogging({ default: 'null' })
})

test('a channel that throws never breaks the caller', () => {
  configureLogging({ default: 'bad', channels: { bad: { driver: 'custom', via: () => () => { throw new Error('down') } } } })
  assert.doesNotThrow(() => logger.error('still fine'))
  configureLogging({ default: 'null' })
})
