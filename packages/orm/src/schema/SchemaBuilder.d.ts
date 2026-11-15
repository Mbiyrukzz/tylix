import type { Schema, TableBuilder } from '@tylix/shared'
import type { DatabaseAdapter } from '../adapters/DatabaseAdapter.js'

/** The schema builder migrations get, for any adapter (SQL or MongoDB). */
export declare function createSchema(adapter: DatabaseAdapter): Schema
export declare class Blueprint {
  constructor(table: string, options?: { alter?: boolean })
  table: string
}
export interface Blueprint extends TableBuilder {}
/** user_id -> users */
export declare function guessTable(columnName: string): string
export declare const SQL_DIALECTS: string[]
export declare function indexName(table: string, columns: string[], kind: 'index' | 'unique' | 'foreign'): string
export declare function compileCreateTable(dialect: string, table: string, blueprint: Blueprint, options?: { ifNotExists?: boolean }): string[]
