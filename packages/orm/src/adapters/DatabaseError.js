const DRIVER_LABELS = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
}

/**
 * Thrown by every database adapter instead of the raw driver error.
 * Same shape for MySQL, PostgreSQL, SQLite and MongoDB, so the server
 * and the debug page never need to know which driver is in use.
 */
export class DatabaseError extends Error {
  constructor(
    message,
    {
      driver = null,
      kind = 'unknown',
      title = null,
      hint = null,
      code = null,
      detail = null,
      table = null,
      column = null,
      sql = null,
      params = [],
      cause = null,
    } = {},
  ) {
    super(message)
    this.name = 'DatabaseError'
    this.driver = driver
    this.kind = kind
    this.title = title
    this.hint = hint
    this.code = code
    this.detail = detail
    this.table = table
    this.column = column
    this.sql = sql
    this.params = params
    this.cause = cause
  }

  // Safe-to-serialize view used by the debug response. The stack is
  // added by the server, only when debug mode is on.
  toJSON() {
    return {
      name: this.name,
      driver: this.driver,
      kind: this.kind,
      title: this.title,
      message: this.message,
      hint: this.hint,
      code: this.code,
      detail: this.detail,
      table: this.table,
      column: this.column,
      sql: this.sql,
      params: (this.params ?? []).map(safeParam),
    }
  }
}

function safeParam(value) {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `<${value.length} bytes>`
  }
  if (typeof value === 'string' && value.length > 200) {
    return `${value.slice(0, 200)}… (${value.length} chars)`
  }
  return value
}

// ---------------------------------------------------------------
// What each kind means, in plain language, and how to fix it.
// ---------------------------------------------------------------

const KIND_INFO = {
  connection_failed: ({ driver }) => ({
    title: `Cannot connect to ${DRIVER_LABELS[driver] ?? 'the database'}`,
    hint: 'Make sure the database server is running, and that the host, port and file/URL in your .env are correct.',
  }),
  auth_failed: () => ({
    title: 'Database login was rejected',
    hint: 'The username or password is wrong. Check DATABASE_USER and DATABASE_PASSWORD in your .env.',
  }),
  unknown_database: () => ({
    title: 'The database does not exist',
    hint: 'Create the database first, or fix DATABASE_NAME in your .env.',
  }),
  missing_table: ({ table }) => ({
    title: table ? `Table "${table}" does not exist` : 'Table does not exist',
    hint: 'The migration that creates this table has not run yet. Run `npx tylix migrate`, or check the table name for typos.',
  }),
  missing_column: ({ column, table }) => ({
    title: column
      ? `Column "${column}" does not exist${table ? ` on "${table}"` : ''}`
      : 'Column does not exist',
    hint: 'Either a migration adding this column has not run (try `npx tylix migrate`), or the column name is misspelled in your model or query.',
  }),
  duplicate_key: ({ detail }) => ({
    title: 'A unique rule was violated',
    hint: `${detail ? `${detail}. ` : ''}A row with this value already exists. Check the existing data, or validate for duplicates before inserting.`,
  }),
  not_null: ({ column }) => ({
    title: column ? `"${column}" cannot be empty` : 'A required value is missing',
    hint: 'This column is NOT NULL and no value was given. Make sure the form or payload sends it, or give the column a default in the migration.',
  }),
  foreign_key: () => ({
    title: 'A relationship (foreign key) rule was violated',
    hint: 'Either you referenced a row that does not exist, or you are deleting a row that other rows still point to.',
  }),
  data_too_long: ({ column }) => ({
    title: column ? `Value is too long for "${column}"` : 'Value is too long for its column',
    hint: 'Shorten the value, or change the column to a larger type (for example `text` instead of `string`).',
  }),
  syntax: () => ({
    title: 'The SQL has a syntax error',
    hint: 'Look at the SQL below. The database stopped at the spot it quotes in the message.',
  }),
  unsupported_query: () => ({
    title: 'This adapter cannot run that query',
    hint: 'MongoAdapter only understands a limited set of simple query shapes. Use the model query builder, or extend parseQuery().',
  }),
  driver_missing: () => ({
    title: 'SQLite support is not available',
    hint: 'SQLite uses the built-in node:sqlite module, which needs Node.js 22.5 or newer. Upgrade Node, or pick another database.',
  }),
  unknown: ({ driver }) => ({
    title: `${DRIVER_LABELS[driver] ?? 'Database'} error`,
    hint: null,
  }),
}

// ---------------------------------------------------------------
// Per-driver classifiers. Each returns { kind, table, column, detail }.
// ---------------------------------------------------------------

const lastSegment = (name) => (name ? name.split('.').pop() : null)

function splitQualified(name) {
  if (!name) return { table: null, column: null }
  const parts = name.split('.')
  if (parts.length < 2) return { table: null, column: parts[0] }
  return { table: parts[parts.length - 2], column: parts[parts.length - 1] }
}

const MYSQL_KINDS = {
  ER_NO_SUCH_TABLE: 'missing_table',
  ER_BAD_TABLE_ERROR: 'missing_table',
  ER_BAD_FIELD_ERROR: 'missing_column',
  ER_DUP_ENTRY: 'duplicate_key',
  ER_BAD_NULL_ERROR: 'not_null',
  ER_NO_DEFAULT_FOR_FIELD: 'not_null',
  ER_NO_REFERENCED_ROW_2: 'foreign_key',
  ER_ROW_IS_REFERENCED_2: 'foreign_key',
  ER_PARSE_ERROR: 'syntax',
  ER_ACCESS_DENIED_ERROR: 'auth_failed',
  ER_BAD_DB_ERROR: 'unknown_database',
  ER_DATA_TOO_LONG: 'data_too_long',
  ECONNREFUSED: 'connection_failed',
  ENOTFOUND: 'connection_failed',
  ETIMEDOUT: 'connection_failed',
  ECONNRESET: 'connection_failed',
  PROTOCOL_CONNECTION_LOST: 'connection_failed',
}

function classifyMysql(err, message) {
  const kind = MYSQL_KINDS[err.code] ?? 'unknown'
  let table = null
  let column = null
  let detail = null
  let m

  if ((m = /Table '([^']+)' doesn't exist/.exec(message))) {
    table = lastSegment(m[1])
  }
  m =
    /Unknown column '([^']+)'/.exec(message) ||
    /Column '([^']+)' cannot be null/.exec(message) ||
    /Field '([^']+)' doesn't have a default value/.exec(message) ||
    /Data too long for column '([^']+)'/.exec(message)
  if (m) column = m[1]
  if ((m = /Duplicate entry '(.*)' for key '(.*)'/.exec(message))) {
    detail = `Value "${m[1]}" already exists for key ${m[2]}`
  }
  return { kind, table, column, detail }
}

const PG_KINDS = {
  '42P01': 'missing_table',
  '42703': 'missing_column',
  '23505': 'duplicate_key',
  '23502': 'not_null',
  '23503': 'foreign_key',
  '42601': 'syntax',
  '22001': 'data_too_long',
  '28P01': 'auth_failed',
  '28000': 'auth_failed',
  '3D000': 'unknown_database',
  ECONNREFUSED: 'connection_failed',
  ENOTFOUND: 'connection_failed',
  ETIMEDOUT: 'connection_failed',
  ECONNRESET: 'connection_failed',
}

function classifyPostgres(err, message) {
  const kind = PG_KINDS[err.code] ?? 'unknown'
  let table = err.table ?? null
  let column = err.column ?? null
  let m

  if (!table && (m = /relation "([^"]+)" does not exist/.exec(message))) {
    table = lastSegment(m[1])
  }
  if (!table && (m = /of relation "([^"]+)"/.exec(message))) table = m[1]
  if (!column && (m = /column "([^"]+)"/.exec(message))) column = m[1]

  return { kind, table, column, detail: err.detail ?? null }
}

function classifySqlite(err, message) {
  let m

  if (/node:sqlite/.test(message)) {
    return { kind: 'driver_missing', table: null, column: null, detail: null }
  }
  if ((m = /no such table: (\S+)/.exec(message))) {
    return { kind: 'missing_table', table: lastSegment(m[1]), column: null, detail: null }
  }
  if ((m = /table (\S+) has no column named (\S+)/.exec(message))) {
    return { kind: 'missing_column', table: m[1], column: m[2], detail: null }
  }
  if ((m = /no such column: (\S+)/.exec(message))) {
    return { kind: 'missing_column', table: null, column: m[1], detail: null }
  }
  if ((m = /UNIQUE constraint failed: (.+)/.exec(message))) {
    const { table, column } = splitQualified(m[1].split(',')[0].trim())
    return { kind: 'duplicate_key', table, column, detail: `Unique rule on ${m[1]}` }
  }
  if ((m = /NOT NULL constraint failed: (\S+)/.exec(message))) {
    const { table, column } = splitQualified(m[1])
    return { kind: 'not_null', table, column, detail: null }
  }
  if (/FOREIGN KEY constraint failed/.test(message)) {
    return { kind: 'foreign_key', table: null, column: null, detail: null }
  }
  if (/syntax error/i.test(message)) {
    return { kind: 'syntax', table: null, column: null, detail: null }
  }
  if (/unable to open database file/i.test(message)) {
    return { kind: 'connection_failed', table: null, column: null, detail: null }
  }
  return { kind: 'unknown', table: null, column: null, detail: null }
}

function classifyMongo(err, message) {
  const none = { table: null, column: null, detail: null }
  let m

  if (err.code === 11000) {
    const table = (m = /collection: (\S+)/.exec(message)) ? lastSegment(m[1]) : null
    const detail = err.keyValue
      ? `Value ${JSON.stringify(err.keyValue)} already exists`
      : null
    return { kind: 'duplicate_key', table, column: null, detail }
  }
  if (
    /^Mongo(ServerSelection|Network|NetworkTimeout|Parse)Error$/.test(err.name) ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ENOTFOUND'
  ) {
    return { kind: 'connection_failed', ...none }
  }
  if (err.code === 18 || err.codeName === 'AuthenticationFailed') {
    return { kind: 'auth_failed', ...none }
  }
  if (
    /does not recognize this query shape|cannot handle query type|Unsupported where operator/.test(
      message,
    )
  ) {
    return { kind: 'unsupported_query', ...none }
  }
  return { kind: 'unknown', ...none }
}

const CLASSIFIERS = {
  mysql: classifyMysql,
  postgres: classifyPostgres,
  sqlite: classifySqlite,
  mongodb: classifyMongo,
}

/**
 * Turns any driver error into a DatabaseError. Adapters call this in
 * their catch blocks. Already-normalized errors pass through untouched.
 */
export function normalizeDatabaseError(driver, err, { sql = null, params = [] } = {}) {
  if (err instanceof DatabaseError) return err

  // mysql2 can throw an AggregateError with an empty message when
  // "localhost" resolves to several addresses and all refuse.
  const message =
    err?.sqlMessage || err?.message || err?.code || String(err) || 'Unknown database error'

  const classify = CLASSIFIERS[driver]
  const info = classify
    ? classify(err ?? {}, message)
    : { kind: 'unknown', table: null, column: null, detail: null }

  const { title, hint } = (KIND_INFO[info.kind] ?? KIND_INFO.unknown)({
    driver,
    ...info,
  })

    const error = new DatabaseError(message, {
    driver,
    kind: info.kind,
    title,
    hint,
    code: err?.code ?? err?.codeName ?? null,
    detail: info.detail,
    table: info.table,
    column: info.column,
    sql,
    params,
    cause: err,
  })
  // Start the stack at whoever called the adapter, not inside this factory.
  Error.captureStackTrace?.(error, normalizeDatabaseError)
  return error
}
