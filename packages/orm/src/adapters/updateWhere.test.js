import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteAdapter } from './SqliteAdapter.js'
import { ConnectionManager } from '../model/ConnectionManager.js'
import { Model } from '../model/Model.js'

class Job extends Model {
  static table = 'jobs'
  static fillable = ['status']
  static timestamps = true
}

test('updateWhere is a check-and-set: only one of two claims wins', async () => {
  const db = await new SqliteAdapter({ filename: ':memory:' }).connect()
  ConnectionManager.setAdapter(db)
  await db.run('CREATE TABLE jobs (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT, updated_at TEXT)')
  const job = await Job.create({ status: 'pending' })
  const first = await Job.updateWhere({ id: job.id, status: 'pending' }, { status: 'processing' })
  const second = await Job.updateWhere({ id: job.id, status: 'pending' }, { status: 'processing' })
  assert.deepEqual([first, second], [1, 0])
  assert.equal((await Job.find(job.id)).status, 'processing')
  await assert.rejects(db.updateWhere('jobs', { status: 'x' }, {}), /at least one condition/)
  await db.close()
})
