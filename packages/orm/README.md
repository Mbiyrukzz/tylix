# @tylix/orm

A lightweight ORM for Tylix applications with adapters for SQLite,
PostgreSQL, MySQL, and MongoDB.

## What's included

- **Adapters** — `DatabaseAdapter` (base interface), `SqliteAdapter`,
  `PostgresAdapter`, `MysqlAdapter`, `MongoAdapter`, selected at
  runtime via `AdapterFactory`
- **Model** — `Model` base class, backed by `ConnectionManager`
- **Query** — `QueryBuilder` and `buildSelectSql` for building queries
  independent of the underlying adapter

## Usage

```js
import { Model, QueryBuilder } from '@tylix/orm'

class Invoice extends Model {
  static table = 'invoices'
}
```

Ships with a `d.ts` declaration file. Pairs with the model/migration
templates in `@tylix/generator`.

## License

MIT
