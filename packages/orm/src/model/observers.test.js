import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SqliteAdapter } from '../adapters/SqliteAdapter.js'
import { ConnectionManager } from './ConnectionManager.js'
import { Model } from './Model.js'
import { Searchable, use } from './traits.js'

let tmpDir
let adapter

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-observer-test-'))
  adapter = new SqliteAdapter({ filename: path.join(tmpDir, 'test.sqlite') })
  await adapter.connect()
  await adapter.run(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT,
    slug TEXT, created_at TEXT, updated_at TEXT)`)
  ConnectionManager.setAdapter(adapter)
})

afterEach(async () => {
  await adapter.close()
  await fs.rm(tmpDir, { recursive: true, force: true })
  ConnectionManager.reset()
})

test('hooks run in order with the data, rows and model class', async () => {
  const calls = []
  class Recorder {
    creating(data, Model) {
      calls.push(['creating', data.title, Model.name])
    }
    created(row) {
      calls.push(['created', row.id])
    }
    updating(data, before) {
      calls.push(['updating', data.title, before.title])
    }
    updated(row, before) {
      calls.push(['updated', row.title, before.title])
    }
    deleting(row) {
      calls.push(['deleting', row.title])
    }
    deleted(row) {
      calls.push(['deleted', row.id])
    }
  }
  class Post extends Model {
    static table = 'posts'
    static fillable = ['title', 'body']
    static observers = [Recorder]
  }

  const post = await Post.create({ title: 'One' })
  await Post.update(post.id, { title: 'Two' })
  await Post.delete(post.id)
  await Post.delete(999) // missing row: no hooks

  assert.deepEqual(calls, [
    ['creating', 'One', 'Post'],
    ['created', post.id],
    ['updating', 'Two', 'One'],
    ['updated', 'Two', 'One'],
    ['deleting', 'Two'],
    ['deleted', post.id],
  ])
})

test('creating/updating may return new data, and may cancel by throwing', async () => {
  class Post extends Model {
    static table = 'posts'
    static fillable = ['title', 'body', 'slug']
    static observers = [
      {
        creating: (data) => ({ ...data, slug: data.title.toLowerCase().replace(/\s+/g, '-') }),
        updating: (data) => {
          if (data.title === 'forbidden') throw new Error('not allowed')
        },
      },
    ]
  }
  const post = await Post.create({ title: 'Hello World' })
  assert.equal(post.slug, 'hello-world')

  await assert.rejects(Post.update(post.id, { title: 'forbidden' }), /not allowed/)
  assert.equal((await Post.find(post.id)).title, 'Hello World', 'cancelled update changed nothing')
})

test('observe() adds observers at runtime; class observers are created once', async () => {
  let instances = 0
  const seen = []
  class Counter {
    constructor() {
      instances++
    }
    created(row) {
      seen.push(row.title)
    }
  }
  class Post extends Model {
    static table = 'posts'
    static fillable = ['title']
  }
  Post.observe(Counter)
  await Post.create({ title: 'a' })
  await Post.create({ title: 'b' })
  assert.deepEqual(seen, ['a', 'b'])
  assert.equal(instances, 1)
})

test('observers from traits run alongside the model own', async () => {
  const order = []
  const Audited = (Base) =>
    class extends Base {
      static observers = [{ created: () => order.push('trait') }]
    }
  class Post extends use(Model, Audited) {
    static table = 'posts'
    static fillable = ['title']
    static observers = [{ created: () => order.push('model') }]
  }
  await Post.create({ title: 'x' })
  assert.deepEqual(order, ['trait', 'model'])
})

test('a model without observers skips the extra lookups', async () => {
  class Post extends Model {
    static table = 'posts'
    static fillable = ['title']
  }
  const original = Post.find.bind(Post)
  let finds = 0
  Post.find = async (id) => {
    finds++
    return original(id)
  }
  const post = await Post.create({ title: 'x' }) // 1 find: create returns the row
  await Post.update(post.id, { title: 'y' }) // 1 find: update returns the row
  await Post.delete(post.id) // none
  assert.equal(finds, 2)
})

test('Searchable adds search() over several columns', async () => {
  class Post extends use(Model, Searchable({ fields: ['title', 'body'] })) {
    static table = 'posts'
    static fillable = ['title', 'body']
  }
  await Post.create({ title: 'Tylix tips', body: 'short' })
  await Post.create({ title: 'Other', body: 'all about TYLIX' })
  await Post.create({ title: 'Unrelated', body: 'nothing' })

  const found = await Post.search('tylix')
  assert.deepEqual(found.map((p) => p.title).sort(), ['Other', 'Tylix tips'])
  assert.equal((await Post.search('tylix', { limit: 1 })).length, 1)
  assert.deepEqual(await Post.search('   '), [])
  assert.equal(Post.name, 'Post', 'the model keeps its own name')
})

test('trait mistakes are explained', () => {
  assert.throws(() => Searchable({ fields: [] }), /needs a list of column names/)
  assert.throws(() => Searchable({ fields: ['title; DROP'] }), /needs a list of column names/)
  assert.throws(() => use(Model, Searchable), /Searchable is a trait factory: call it/)
  assert.throws(() => use(Model, 'nope'), /is not a function/)
})
