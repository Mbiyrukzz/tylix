export type ComparisonOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'like'

export type ListOperator = 'IN' | 'NOT IN'

export type NullOperator = 'IS NULL' | 'IS NOT NULL'

export interface WhereClause {
  field: string
  operator: ComparisonOperator | ListOperator | NullOperator
  value: unknown
}

export interface OrderClause {
  field: string
  direction: 'ASC' | 'DESC'
}

export interface QueryDescriptor {
  wheres: WhereClause[]
  orders: OrderClause[]
  limitValue?: number
  offsetValue?: number
}

export interface ColumnBuilder {
  unique(): void;
}

export interface TableBuilder {
  increments(name: string): ColumnBuilder;
  string(name: string): ColumnBuilder;
  text(name: string): ColumnBuilder;
  boolean(name: string): ColumnBuilder;
  integer(name: string): ColumnBuilder;
  date(name: string): ColumnBuilder;
  datetime(name: string): ColumnBuilder;
  json(name: string): ColumnBuilder;
  timestamps(): void;
  // present only in alterTable's callback, absent from createTable's
  dropColumn?(name: string): void;
}

export interface Schema {
  createTable(tableName: string, callback: (table: TableBuilder) => void | Promise<void>): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  alterTable(tableName: string, callback: (table: TableBuilder) => void | Promise<void>): Promise<void>;
}