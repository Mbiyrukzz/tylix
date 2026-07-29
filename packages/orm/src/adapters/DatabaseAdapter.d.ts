import type { QueryDescriptor } from '../query/types.js';

export interface RunResult {
    lastInsertRowid: number;
}

export declare class DatabaseAdapter {
    connect(): Promise<this>;
    close(): Promise<void>;
    run(sql: string, params?: unknown[]): Promise<RunResult>;
    get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null>;
    all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
    columnType(logicalType: string): string | null;
    count(table: string): Promise<number>;
    paginate(table: string, limit: number, offset: number): Promise<Record<string, unknown>[]>;
    listTables(): Promise<string[]>;
    query(table: string, descriptor?: QueryDescriptor): Promise<Record<string, unknown>[]>;
}