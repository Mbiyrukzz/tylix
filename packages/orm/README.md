# @tylix/orm

Models, a query builder, a schema builder for migrations, and adapters for
SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB and MongoDB.

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

## Databases

```js
import { createAdapter, ConnectionManager } from '@tylix/orm'

const db = await createAdapter({ driver: 'cockroach', host: '127.0.0.1', database: 'shop' }).connect()
ConnectionManager.setAdapter(db)
```

| `driver` | Package used | Notes |
| --- | --- | --- |
| `sqlite` | `node:sqlite` | a file; nothing to install |
| `postgres` | `pg` | `connectionString`, `ssl` |
| `cockroach` | `pg` | ids count 1, 2, 3 and come back as numbers, as on PostgreSQL |
| `mysql` | `mysql2` | |
| `mariadb` | `mysql2` | |
| `mongodb` | `mongodb` | SQL-shaped calls are translated |

Every adapter has a `dialect`; SQLite and PostgreSQL also have
`transaction(fn)`. `ensureDatabaseExists(config)` creates the database on
PostgreSQL, CockroachDB, MySQL and MariaDB.

## Migrations

`tylix migrate` passes each migration a schema builder. In your own code:
`createSchema(adapter)`.

```js
export const up = async (schema) => {
  await schema.createTable('posts', (table) => {
    table.increments('id')
    table.string('title', 200).notNullable()
    table.string('slug').unique()
    table.enum('status', ['draft', 'published']).default('draft').index()
    table.decimal('price', 10, 2).default(0)
    table.foreignId('user_id').constrained().cascadeOnDelete()
    table.timestamps()
    table.index(['status', 'created_at'])
  })

  await schema.alterTable('comments', (table) => {
    table.string('author', 120).notNullable().change()
    table.renameColumn('body', 'content')
    table.dropIndex(['status'])
    table.dropForeign(['post_id'])
    table.dropColumn('legacy')
  })
}
```

- **Types:** `increments`, `bigIncrements`, `string(n)`, `char`, `text`,
  `mediumText`, `longText`, `boolean`, `integer`, `bigInteger`,
  `smallInteger`, `float`, `decimal(p, s)`, `date`, `datetime`,
  `timestamp`, `time`, `json`, `uuid`, `binary`, `enum`, `foreignId`,
  `timestamps()`, `softDeletes()`.
- **Modifiers:** `nullable()` (the default), `notNullable()`,
  `default(value)`, `useCurrent()`, `unique()`, `index()`, `primary()`,
  `unsigned()`, `comment()`, `after()`, `change()`, plus `references`, `on`,
  `constrained`, `onDelete` and `onUpdate`.
- **Tables:** `createTable`, `alterTable`, `dropTable`, `renameTable`,
  `hasTable`, `hasColumn`, `getColumns`, `getIndexes`, `raw`. Laravel's
  names (`create`, `table`, `dropIfExists`) work too.
- Indexes are named `<table>_<columns>_index` / `_unique` / `_foreign`, so
  they can be dropped by their columns.
- SQLite can't change a column in place, so `change()` and foreign-key
  changes rebuild the table, keeping its rows, indexes and keys.
- On MongoDB, indexes, renames and dropped fields apply, and the rest is
  ignored.

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

## Testing against database servers

`npm test` uses SQLite. To run the schema tests against real servers:

```sh
TYLIX_TEST_DATABASES='postgres://postgres:pw@127.0.0.1:5432/x,cockroach://root@127.0.0.1:26257/x,mysql://root:pw@127.0.0.1:3306/x,mariadb://root:pw@127.0.0.1:3307/x,mongodb://127.0.0.1:27017/x' \
  node --test src/schema/SchemaBuilder.servers.test.js
```

## License

MIT
