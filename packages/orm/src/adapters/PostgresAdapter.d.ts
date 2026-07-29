import { DatabaseAdapter } from './DatabaseAdapter.js';

export interface PostgresAdapterOptions {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
}

export declare class PostgresAdapter extends DatabaseAdapter {
    constructor(options?: PostgresAdapterOptions);
}

export declare function toPositionalPlaceholders(sql: string): string;
export declare function ensureReturningId(sql: string): string;