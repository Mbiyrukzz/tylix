import { DatabaseAdapter } from './DatabaseAdapter.js';

export interface MongoAdapterOptions {
    url?: string;
    database?: string;
}

export type ParsedMongoQuery =
    | { type: 'createTable'; table: string }
    | { type: 'dropTable'; table: string }
    | { type: 'alterAddColumn'; table: string; column: string }
    | { type: 'alterDropColumn'; table: string; column: string }
    | { type: 'findOne'; table: string; field: string }
    | { type: 'findAll'; table: string }
    | { type: 'insert'; table: string; columns: string[] }
    | { type: 'update'; table: string; columns: string[]; whereField: string }
    | { type: 'delete'; table: string; field: string };

export declare function parseQuery(sql: string): ParsedMongoQuery;

export declare class MongoAdapter extends DatabaseAdapter {
    constructor(options?: MongoAdapterOptions);
}