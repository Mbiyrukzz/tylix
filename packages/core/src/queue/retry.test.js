import { test } from 'node:test'
import assert from 'node:assert/strict'
import { afterFailure, backoffSeconds, jobOptions, JobTimeoutError, PermanentJobError, runWithTimeout } from './retry.js'

test('jobOptions: job settings win over queue config and defaults', () => {
  assert.deepEqual(jobOptions(), { tries: 1, backoff: 0, maxBackoff: 3600, timeout: 0 })
  assert.equal(jobOptions({}, { tries: 4 }).tries, 4)
  assert.equal(jobOptions({ tries: 2 }, { tries: 4 }).tries, 2)
  assert.equal(jobOptions({ tries: 0 }).tries, 1)
})

test('backoffSeconds: number, list, function and exponential', () => {
  assert.equal(backoffSeconds(jobOptions({ backoff: 30 }), 1), 30)
  const list = jobOptions({ backoff: [10, 60, 300] })
  assert.deepEqual([1, 2, 3, 4, 9].map((a) => backoffSeconds(list, a)), [10, 60, 300, 300, 300])
  assert.equal(backoffSeconds(jobOptions({ backoff: (a) => a * 7 }), 3), 21)
  const exp = jobOptions({ backoff: 'exponential', maxBackoff: 10 })
  assert.deepEqual([1, 2, 3, 4, 5].map((a) => backoffSeconds(exp, a, () => 1)), [1, 2, 4, 8, 10])
  assert.equal(backoffSeconds(exp, 4, () => 0), 4)
})

test('afterFailure: retries until tries run out; permanent errors stop at once', () => {
  const options = jobOptions({ tries: 3, backoff: [5] })
  const first = afterFailure(options, 1, new Error('x'), 1000)
  assert.equal(first.retry, true)
  assert.equal(first.availableAt.getTime(), 6000)
  assert.equal(afterFailure(options, 3, new Error('x')).retry, false)
  assert.equal(afterFailure(options, 1, new PermanentJobError('no')).retry, false)
  assert.equal(afterFailure(options, 1, Object.assign(new Error('no'), { retryable: false })).retry, false)
})

test('runWithTimeout rejects a slow attempt', async () => {
  assert.equal(await runWithTimeout(async () => 1, 0), 1)
  await assert.rejects(runWithTimeout(() => new Promise((r) => setTimeout(r, 200)), 0.02), JobTimeoutError)
})
