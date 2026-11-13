# @tylix/orm

Models, a query builder and migrations-ready adapters for SQLite,
PostgreSQL, MySQL and MongoDB.

```sh
npm install @tylix/orm
```

## Models

```js
import { Model } from '@tylix/orm'

export class Post extends Model {
  static table = 'posts'
  static fillable = ['title', 'body', 'user_id']
}

const post = await Post.create({ title: 'Hello', body: '...', user_id: 1 })
const recent = await Post.where('user_id', 1).latest().limit(10).get()
const page = await Post.paginate({ page: 2, limit: 20 })
const claimed = await Job.updateWhere({ id, status: 'pending' }, { status: 'processing' }) // 1 or 0
```

## Observers and traits

```js
import { Model, Searchable, use } from '@tylix/orm'

class Post extends use(Model, Searchable({ fields: ['title', 'body'] })) {
  static table = 'posts'
  static observers = [PostObserver] // creating/created, updating/updated, deleting/deleted
}

const results = await Post.search('tylix')
```

## Query timing

```js
import { onQuery } from '@tylix/orm'

onQuery(({ driver, sql, durationMs }) => { /* log, measure */ })
```

The Tylix CLI uses this for slow-query warnings and metrics. Nothing is
timed while no one listens.

SQLite statements are prepared once and reused; a migration run by
another process is picked up within a second.

## License

MIT
