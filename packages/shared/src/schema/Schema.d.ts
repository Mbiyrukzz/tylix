// The schema builder migrations receive (createSchema in @tylix/orm).

export type ForeignAction = 'cascade' | 'set null' | 'restrict' | 'no action' | 'set default'

export interface ColumnDef {
  /** NULL allowed (the default for every column). */
  nullable(value?: boolean): ColumnDef
  /** NOT NULL. */
  notNullable(): ColumnDef
  /** Same as notNullable(). */
  required(): ColumnDef
  /** DEFAULT value; { raw: 'CURRENT_TIMESTAMP' } for SQL. */
  default(value: string | number | boolean | null | Date | object | { raw: string }): ColumnDef
  /** DEFAULT CURRENT_TIMESTAMP. */
  useCurrent(): ColumnDef
  /** A unique index named <table>_<column>_unique (or `name`). */
  unique(name?: string): ColumnDef
  /** An index named <table>_<column>_index (or `name`). */
  index(name?: string): ColumnDef
  primary(): ColumnDef
  /** MySQL / MariaDB. */
  unsigned(): ColumnDef
  comment(text: string): ColumnDef
  /** MySQL / MariaDB: place a new column after another. */
  after(column: string): ColumnDef
  /** alterTable: change the existing column to this definition. */
  change(): ColumnDef
  references(column?: string): ColumnDef
  on(table: string): ColumnDef
  /** References <table>.id; the table is guessed from the column (user_id -> users). */
  constrained(table?: string, column?: string): ColumnDef
  onDelete(action: ForeignAction): ColumnDef
  onUpdate(action: ForeignAction): ColumnDef
  cascadeOnDelete(): ColumnDef
  nullOnDelete(): ColumnDef
  restrictOnDelete(): ColumnDef
}

export interface ForeignKeyDef {
  references(column?: string): ForeignKeyDef
  on(table: string): ForeignKeyDef
  onDelete(action: ForeignAction): ForeignKeyDef
  onUpdate(action: ForeignAction): ForeignKeyDef
  cascadeOnDelete(): ForeignKeyDef
  nullOnDelete(): ForeignKeyDef
  name(value: string): ForeignKeyDef
}

export interface TableBuilder {
  increments(name?: string): ColumnDef
  id(name?: string): ColumnDef
  bigIncrements(name?: string): ColumnDef
  string(name: string, length?: number): ColumnDef
  char(name: string, length?: number): ColumnDef
  text(name: string): ColumnDef
  mediumText(name: string): ColumnDef
  longText(name: string): ColumnDef
  boolean(name: string): ColumnDef
  integer(name: string): ColumnDef
  bigInteger(name: string): ColumnDef
  smallInteger(name: string): ColumnDef
  /** A number that may have decimals (REAL / DOUBLE). */
  float(name: string): ColumnDef
  double(name: string): ColumnDef
  decimal(name: string, precision?: number, scale?: number): ColumnDef
  date(name: string): ColumnDef
  datetime(name: string): ColumnDef
  dateTime(name: string): ColumnDef
  timestamp(name: string): ColumnDef
  time(name: string): ColumnDef
  json(name: string): ColumnDef
  jsonb(name: string): ColumnDef
  uuid(name?: string): ColumnDef
  binary(name: string): ColumnDef
  enum(name: string, values: string[]): ColumnDef
  /** An integer column for a foreign key: foreignId('user_id').constrained() */
  foreignId(name: string): ColumnDef
  /** created_at and updated_at. */
  timestamps(): void
  softDeletes(name?: string): ColumnDef

  index(columns: string | string[], name?: string): TableBuilder
  unique(columns: string | string[], name?: string): TableBuilder
  primaryKey(columns: string | string[]): TableBuilder
  foreign(columns: string | string[], name?: string): ForeignKeyDef
}

export interface CreateTableBuilder extends TableBuilder {}

export interface AlterTableBuilder extends TableBuilder {
  dropColumn(...names: string[]): AlterTableBuilder
  dropColumns(...names: string[]): AlterTableBuilder
  dropTimestamps(): AlterTableBuilder
  dropSoftDeletes(name?: string): AlterTableBuilder
  renameColumn(from: string, to: string): AlterTableBuilder
  /** An index name, or the columns it covers. */
  dropIndex(nameOrColumns: string | string[]): AlterTableBuilder
  dropUnique(nameOrColumns: string | string[]): AlterTableBuilder
  dropForeign(nameOrColumns: string | string[]): AlterTableBuilder
}

export interface Schema {
  createTable(tableName: string, callback: (table: CreateTableBuilder) => void | Promise<void>, options?: { ifNotExists?: boolean }): Promise<void>
  alterTable(tableName: string, callback: (table: AlterTableBuilder) => void | Promise<void>): Promise<void>
  dropTable(tableName: string): Promise<void>
  renameTable(from: string, to: string): Promise<void>
  hasTable(tableName: string): Promise<boolean>
  hasColumn(tableName: string, column: string): Promise<boolean>
  getColumns(tableName: string): Promise<string[]>
  getIndexes(tableName: string): Promise<string[]>
  dropColumnIfExists(tableName: string, column: string): Promise<void>
  /** Laravel names. */
  create: Schema['createTable']
  table: Schema['alterTable']
  drop: Schema['dropTable']
  dropIfExists: Schema['dropTable']
  rename: Schema['renameTable']
  /** For statements the builder can't express (SQL databases only). */
  raw(sql: string, params?: unknown[]): Promise<void>
  dialect?: 'sqlite' | 'postgres' | 'cockroach' | 'mysql' | 'mariadb'
}
