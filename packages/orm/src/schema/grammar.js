import crypto from 'node:crypto'

// SQL for each dialect the schema builder supports. Pure functions: they
// turn column and index descriptions into statements, so they can be
// tested without a database.

export const SQL_DIALECTS = ['sqlite', 'postgres', 'cockroach', 'mysql', 'mariadb']

const isMysql = (d) => d === 'mysql' || d === 'mariadb'
const isPg = (d) => d === 'postgres' || d === 'cockroach'

export function quote(dialect, name) {
  if (isMysql(dialect)) return `\`${String(name).replace(/`/g, '``')}\``
  return `"${String(name).replace(/"/g, '""')}"`
}

export function quoteString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

// Index and constraint names are limited to 63 (PostgreSQL) or 64
// (MySQL) characters. Longer ones keep their start plus a short hash, so
// the same columns always give the same name.
export function indexName(table, columns, kind) {
  const name = `${table}_${columns.join('_')}_${kind}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  if (name.length <= 60) return name
  const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)
  return `${name.slice(0, 51)}_${hash}`
}

const TEXT_TYPES = new Set(['text', 'mediumText', 'longText', 'json', 'binary'])

export function columnTypeSql(dialect, column) {
  const { type, length, precision = 8, scale = 2, values = [] } = column
  if (dialect === 'sqlite') {
    return {
      increments: 'INTEGER',
      bigIncrements: 'INTEGER',
      boolean: 'INTEGER',
      integer: 'INTEGER',
      bigInteger: 'INTEGER',
      smallInteger: 'INTEGER',
      float: 'REAL',
      decimal: 'NUMERIC',
      binary: 'BLOB',
    }[type] ?? 'TEXT'
  }
  if (isPg(dialect)) {
    const map = {
      increments: 'SERIAL',
      bigIncrements: 'BIGSERIAL',
      string: length ? `VARCHAR(${length})` : 'TEXT',
      char: `CHAR(${length ?? 255})`,
      text: 'TEXT',
      mediumText: 'TEXT',
      longText: 'TEXT',
      boolean: 'BOOLEAN',
      integer: 'INTEGER',
      bigInteger: 'BIGINT',
      smallInteger: 'SMALLINT',
      float: 'DOUBLE PRECISION',
      decimal: `NUMERIC(${precision}, ${scale})`,
      date: 'DATE',
      datetime: 'TIMESTAMP',
      timestamp: 'TIMESTAMP',
      time: 'TIME',
      json: 'JSONB',
      uuid: 'UUID',
      enum: 'VARCHAR(255)',
      binary: 'BYTEA',
    }
    if (!(type in map)) throw new Error(`Unknown column type "${type}".`)
    return map[type]
  }
  if (isMysql(dialect)) {
    const unsigned = column.unsigned ? ' UNSIGNED' : ''
    const map = {
      increments: `INT${unsigned}`,
      bigIncrements: 'BIGINT UNSIGNED',
      string: `VARCHAR(${length ?? 255})`,
      char: `CHAR(${length ?? 255})`,
      text: 'TEXT',
      mediumText: 'MEDIUMTEXT',
      longText: 'LONGTEXT',
      boolean: 'TINYINT(1)',
      integer: `INT${unsigned}`,
      bigInteger: `BIGINT${unsigned}`,
      smallInteger: `SMALLINT${unsigned}`,
      float: 'DOUBLE',
      decimal: `DECIMAL(${precision}, ${scale})${unsigned}`,
      date: 'DATE',
      datetime: 'DATETIME',
      timestamp: 'DATETIME',
      time: 'TIME',
      json: 'JSON',
      uuid: 'CHAR(36)',
      enum: `ENUM(${values.map(quoteString).join(', ')})`,
      binary: 'BLOB',
    }
    if (!(type in map)) throw new Error(`Unknown column type "${type}".`)
    return map[type]
  }
  throw new Error(`The schema builder has no SQL for "${dialect}".`)
}

export function defaultSql(dialect, column) {
  const value = column.default
  if (value === undefined) return null
  if (value === null) return 'NULL'
  if (typeof value === 'object' && value !== null && 'raw' in value) return value.raw
  let literal
  if (typeof value === 'boolean') literal = isPg(dialect) ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  else if (typeof value === 'number' || typeof value === 'bigint') literal = String(value)
  else if (value instanceof Date) literal = quoteString(value.toISOString())
  else if (typeof value === 'object') literal = quoteString(JSON.stringify(value))
  else literal = quoteString(value)
  // MySQL only takes a default on TEXT and JSON columns as an expression.
  if (dialect === 'mysql' && TEXT_TYPES.has(column.type) && value !== null) return `(${literal})`
  return literal
}

export const isAutoIncrement = (column) => column.type === 'increments' || column.type === 'bigIncrements'

// One column, as it appears in CREATE TABLE or ADD COLUMN.
export function columnSql(dialect, column, { inline = {} } = {}) {
  const q = (n) => quote(dialect, n)
  const parts = [q(column.name)]
  if (isAutoIncrement(column)) {
    if (dialect === 'sqlite') parts.push('INTEGER PRIMARY KEY AUTOINCREMENT')
    else if (isPg(dialect)) parts.push(`${columnTypeSql(dialect, column)} PRIMARY KEY`)
    else parts.push(`${columnTypeSql(dialect, column)} AUTO_INCREMENT PRIMARY KEY`)
    return parts.join(' ')
  }
  parts.push(columnTypeSql(dialect, column))
  if (column.nullable === false) parts.push('NOT NULL')
  else if (isMysql(dialect)) parts.push('NULL')
  const def = defaultSql(dialect, column)
  if (def !== null) parts.push(`DEFAULT ${def}`)
  if (column.primary && !inline.skipPrimary) parts.push('PRIMARY KEY')
  if (column.type === 'enum' && !isMysql(dialect) && column.values?.length) {
    parts.push(`CHECK (${q(column.name)} IN (${column.values.map(quoteString).join(', ')}))`)
  }
  if (isMysql(dialect) && column.comment) parts.push(`COMMENT ${quoteString(column.comment)}`)
  if (isMysql(dialect) && column.after) parts.push(`AFTER ${q(column.after)}`)
  if (inline.references && column.references) parts.push(referencesSql(dialect, column.references))
  return parts.join(' ')
}

export function referencesSql(dialect, ref) {
  const q = (n) => quote(dialect, n)
  let sql = `REFERENCES ${q(ref.table)} (${q(ref.column ?? 'id')})`
  if (ref.onDelete) sql += ` ON DELETE ${ref.onDelete.toUpperCase()}`
  if (ref.onUpdate) sql += ` ON UPDATE ${ref.onUpdate.toUpperCase()}`
  return sql
}

export function foreignKeySql(dialect, table, fk) {
  const q = (n) => quote(dialect, n)
  const name = fk.name ?? indexName(table, fk.columns, 'foreign')
  return `CONSTRAINT ${q(name)} FOREIGN KEY (${fk.columns.map(q).join(', ')}) ${referencesSql(dialect, fk)}`
}

export function createIndexSql(dialect, table, index) {
  const q = (n) => quote(dialect, n)
  const name = index.name ?? indexName(table, index.columns, index.unique ? 'unique' : 'index')
  const ifNotExists = dialect === 'mysql' ? '' : 'IF NOT EXISTS '
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${ifNotExists}${q(name)} ON ${q(table)} (${index.columns.map(q).join(', ')})`
}

export function dropIndexSql(dialect, table, name, { unique = false } = {}) {
  const q = (n) => quote(dialect, n)
  if (isMysql(dialect)) return `ALTER TABLE ${q(table)} DROP INDEX ${dialect === 'mariadb' ? 'IF EXISTS ' : ''}${q(name)}`
  // CockroachDB names an index by its table; a unique index is a
  // constraint there and needs CASCADE.
  if (dialect === 'cockroach') return `DROP INDEX IF EXISTS ${q(table)}@${q(name)}${unique ? ' CASCADE' : ''}`
  return `DROP INDEX IF EXISTS ${q(name)}`
}

export function dropForeignSql(dialect, table, name) {
  const q = (n) => quote(dialect, n)
  if (isMysql(dialect)) return `ALTER TABLE ${q(table)} DROP FOREIGN KEY ${dialect === 'mariadb' ? 'IF EXISTS ' : ''}${q(name)}`
  return `ALTER TABLE ${q(table)} DROP CONSTRAINT IF EXISTS ${q(name)}`
}

// Statements that change an existing column to `column` (PostgreSQL,
// CockroachDB, MySQL, MariaDB; SQLite rebuilds the table instead).
export function changeColumnSql(dialect, table, column) {
  const q = (n) => quote(dialect, n)
  if (isMysql(dialect)) return [`ALTER TABLE ${q(table)} MODIFY COLUMN ${columnSql(dialect, column)}`]
  const type = columnTypeSql(dialect, column)
  const col = q(column.name)
  const statements = [`ALTER TABLE ${q(table)} ALTER COLUMN ${col} TYPE ${type} USING ${col}::${type}`]
  statements.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${col} ${column.nullable === false ? 'SET NOT NULL' : 'DROP NOT NULL'}`)
  const def = defaultSql(dialect, column)
  statements.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${col} ${def === null ? 'DROP DEFAULT' : `SET DEFAULT ${def}`}`)
  return statements
}

export function commentSql(dialect, table, column) {
  if (!isPg(dialect) || !column.comment) return null
  return `COMMENT ON COLUMN ${quote(dialect, table)}.${quote(dialect, column.name)} IS ${quoteString(column.comment)}`
}

export function renameTableSql(dialect, from, to) {
  if (isMysql(dialect)) return `RENAME TABLE ${quote(dialect, from)} TO ${quote(dialect, to)}`
  return `ALTER TABLE ${quote(dialect, from)} RENAME TO ${quote(dialect, to)}`
}

// Everything CREATE TABLE needs: the statement, then indexes (MySQL keeps
// them inside the statement, so IF NOT EXISTS covers them too).
export function compileCreateTable(dialect, table, blueprint, { ifNotExists = true } = {}) {
  const q = (n) => quote(dialect, n)
  const { columns, indexes, foreignKeys, primary } = blueprint
  const lines = columns.map((c) => columnSql(dialect, c))
  if (primary) lines.push(`PRIMARY KEY (${primary.map(q).join(', ')})`)
  for (const fk of foreignKeys) lines.push(foreignKeySql(dialect, table, fk))
  const after = []
  for (const index of indexes) {
    if (isMysql(dialect)) {
      const name = index.name ?? indexName(table, index.columns, index.unique ? 'unique' : 'index')
      lines.push(`${index.unique ? 'UNIQUE ' : ''}KEY ${q(name)} (${index.columns.map(q).join(', ')})`)
    } else {
      after.push(createIndexSql(dialect, table, index))
    }
  }
  for (const c of columns) {
    const comment = commentSql(dialect, table, c)
    if (comment) after.push(comment)
  }
  return [`CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${q(table)} (${lines.join(', ')})`, ...after]
}
