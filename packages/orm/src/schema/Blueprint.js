// What a migration's callback describes: columns with their modifiers,
// indexes, foreign keys, and (in alterTable) changes to existing ones.
//
//   schema.createTable('posts', (table) => {
//     table.increments('id')
//     table.string('title').notNullable()
//     table.string('slug', 120).unique()
//     table.enum('status', ['draft', 'published']).default('draft').index()
//     table.foreignId('user_id').constrained().cascadeOnDelete()
//     table.decimal('price', 10, 2).default(0)
//     table.timestamps()
//     table.index(['status', 'created_at'])
//   })
//
//   schema.alterTable('posts', (table) => {
//     table.string('subtitle').nullable().after('title')
//     table.string('title', 500).notNullable().change()
//     table.renameColumn('body', 'content')
//     table.dropColumn('legacy')
//     table.dropIndex(['status'])
//   })
//
// Columns are nullable unless notNullable() is called, as every Tylix
// migration so far assumed.

class ColumnBuilder {
  constructor(blueprint, column) {
    this.blueprint = blueprint
    this.column = column
  }
  nullable(value = true) {
    this.column.nullable = value
    return this
  }
  notNullable() {
    return this.nullable(false)
  }
  required() {
    return this.nullable(false)
  }
  default(value) {
    this.column.default = value
    return this
  }
  // DEFAULT CURRENT_TIMESTAMP
  useCurrent() {
    this.column.default = { raw: 'CURRENT_TIMESTAMP' }
    return this
  }
  unique(name) {
    this.blueprint.indexes.push({ columns: [this.column.name], unique: true, name })
    return this
  }
  index(name) {
    this.blueprint.indexes.push({ columns: [this.column.name], unique: false, name })
    return this
  }
  primary() {
    this.column.primary = true
    return this
  }
  unsigned() {
    this.column.unsigned = true
    return this
  }
  comment(text) {
    this.column.comment = text
    return this
  }
  // MySQL / MariaDB only: where a new column goes.
  after(columnName) {
    this.column.after = columnName
    return this
  }
  // Alter an existing column to this definition (type, null, default).
  change() {
    this.column.change = true
    return this
  }
  // Foreign keys: table.integer('user_id').references('id').on('users')
  references(column = 'id') {
    this.#foreign().column = column
    return this
  }
  on(table) {
    this.#foreign().table = table
    return this
  }
  // table.foreignId('user_id').constrained()  -> references users.id
  constrained(table, column = 'id') {
    const fk = this.#foreign()
    fk.table = table ?? guessTable(this.column.name)
    fk.column = column
    return this
  }
  onDelete(action) {
    this.#foreign().onDelete = action
    return this
  }
  onUpdate(action) {
    this.#foreign().onUpdate = action
    return this
  }
  cascadeOnDelete() {
    return this.onDelete('cascade')
  }
  nullOnDelete() {
    return this.onDelete('set null')
  }
  restrictOnDelete() {
    return this.onDelete('restrict')
  }
  #foreign() {
    let fk = this.blueprint.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === this.column.name)
    if (!fk) {
      fk = { columns: [this.column.name], table: null, column: 'id' }
      this.blueprint.foreignKeys.push(fk)
    }
    this.column.references = fk
    return fk
  }
}

class ForeignBuilder {
  constructor(fk) {
    this.fk = fk
  }
  references(column = 'id') {
    this.fk.column = column
    return this
  }
  on(table) {
    this.fk.table = table
    return this
  }
  onDelete(action) {
    this.fk.onDelete = action
    return this
  }
  onUpdate(action) {
    this.fk.onUpdate = action
    return this
  }
  cascadeOnDelete() {
    return this.onDelete('cascade')
  }
  nullOnDelete() {
    return this.onDelete('set null')
  }
  name(value) {
    this.fk.name = value
    return this
  }
}

// user_id -> users, category_id -> categories
export function guessTable(columnName) {
  const base = columnName.replace(/_id$/, '')
  if (/(s|x|z|ch|sh)$/.test(base)) return `${base}es`
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`
  return `${base}s`
}

const toList = (value) => (Array.isArray(value) ? value : [value])

export class Blueprint {
  constructor(table, { alter = false } = {}) {
    this.table = table
    this.alter = alter
    this.columns = []
    this.indexes = []
    this.foreignKeys = []
    this.primary = null
    this.drops = { columns: [], indexes: [], uniques: [], foreign: [] }
    this.renames = []
  }

  addColumn(type, name, extra = {}) {
    if (!name) throw new Error(`table.${type}() needs a column name.`)
    const column = { name, type, nullable: true, ...extra }
    this.columns.push(column)
    return new ColumnBuilder(this, column)
  }

  // Column types
  increments(name = 'id') {
    return this.addColumn('increments', name, { nullable: false })
  }
  id(name = 'id') {
    return this.increments(name)
  }
  bigIncrements(name = 'id') {
    return this.addColumn('bigIncrements', name, { nullable: false })
  }
  string(name, length) {
    return this.addColumn('string', name, length ? { length } : {})
  }
  char(name, length = 255) {
    return this.addColumn('char', name, { length })
  }
  text(name) {
    return this.addColumn('text', name)
  }
  mediumText(name) {
    return this.addColumn('mediumText', name)
  }
  longText(name) {
    return this.addColumn('longText', name)
  }
  boolean(name) {
    return this.addColumn('boolean', name)
  }
  integer(name) {
    return this.addColumn('integer', name)
  }
  bigInteger(name) {
    return this.addColumn('bigInteger', name)
  }
  smallInteger(name) {
    return this.addColumn('smallInteger', name)
  }
  float(name) {
    return this.addColumn('float', name)
  }
  double(name) {
    return this.addColumn('float', name)
  }
  decimal(name, precision = 8, scale = 2) {
    return this.addColumn('decimal', name, { precision, scale })
  }
  date(name) {
    return this.addColumn('date', name)
  }
  datetime(name) {
    return this.addColumn('datetime', name)
  }
  dateTime(name) {
    return this.datetime(name)
  }
  timestamp(name) {
    return this.addColumn('timestamp', name)
  }
  time(name) {
    return this.addColumn('time', name)
  }
  json(name) {
    return this.addColumn('json', name)
  }
  jsonb(name) {
    return this.json(name)
  }
  uuid(name = 'uuid') {
    return this.addColumn('uuid', name)
  }
  binary(name) {
    return this.addColumn('binary', name)
  }
  enum(name, values) {
    if (!Array.isArray(values) || values.length === 0) throw new Error(`table.enum("${name}", values) needs a list of values.`)
    return this.addColumn('enum', name, { values })
  }
  // An integer column for a foreign key; chain .constrained().
  foreignId(name) {
    return this.addColumn('integer', name)
  }
  timestamps() {
    this.addColumn('timestamp', 'created_at')
    this.addColumn('timestamp', 'updated_at')
  }
  softDeletes(name = 'deleted_at') {
    return this.addColumn('timestamp', name)
  }

  // Table-level indexes and keys
  index(columns, name) {
    this.indexes.push({ columns: toList(columns), unique: false, name })
    return this
  }
  unique(columns, name) {
    this.indexes.push({ columns: toList(columns), unique: true, name })
    return this
  }
  primaryKey(columns) {
    this.primary = toList(columns)
    return this
  }
  foreign(columns, name) {
    const fk = { columns: toList(columns), table: null, column: 'id', name }
    this.foreignKeys.push(fk)
    return new ForeignBuilder(fk)
  }

  // alterTable only
  dropColumn(...names) {
    this.drops.columns.push(...names.flat())
    return this
  }
  dropColumns(...names) {
    return this.dropColumn(...names)
  }
  dropTimestamps() {
    return this.dropColumn('created_at', 'updated_at')
  }
  dropSoftDeletes(name = 'deleted_at') {
    return this.dropColumn(name)
  }
  renameColumn(from, to) {
    this.renames.push({ from, to })
    return this
  }
  // An index name, or the columns it covers.
  dropIndex(nameOrColumns) {
    this.drops.indexes.push(nameOrColumns)
    return this
  }
  dropUnique(nameOrColumns) {
    this.drops.uniques.push(nameOrColumns)
    return this
  }
  dropForeign(nameOrColumns) {
    this.drops.foreign.push(nameOrColumns)
    return this
  }
}
