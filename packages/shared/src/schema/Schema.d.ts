export interface ColumnDef {
  unique(): void
}

export interface CreateTableBuilder {
  increments(name: string): ColumnDef
  string(name: string): ColumnDef
  text(name: string): ColumnDef
  boolean(name: string): ColumnDef
  integer(name: string): ColumnDef
  date(name: string): ColumnDef
  datetime(name: string): ColumnDef
  json(name: string): ColumnDef
  timestamps(): void
}

export interface AlterTableBuilder {
  string(name: string): ColumnDef
  text(name: string): ColumnDef
  boolean(name: string): ColumnDef
  integer(name: string): ColumnDef
  date(name: string): ColumnDef
  datetime(name: string): ColumnDef
  json(name: string): ColumnDef
  dropColumn(name: string): void
}

export interface Schema {
  createTable(tableName: string, callback: (table: CreateTableBuilder) => void | Promise<void>): Promise<void>
  dropTable(tableName: string): Promise<void>
  alterTable(tableName: string, callback: (table: AlterTableBuilder) => void | Promise<void>): Promise<void>
}