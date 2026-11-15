import type { QueryDescriptor } from '../query/types.js';

export interface RunResult {
    lastInsertRowid: number;
}

export declare class DatabaseAdapter {
    /** SQL keyword used for LIKE conditions: "LIKE" by default, "ILIKE" on Postgres. */
    readonly likeOperator: 'LIKE' | 'ILIKE';

    /** Which SQL the schema builder writes for this database. */
    readonly dialect: 'sqlite' | 'postgres' | 'cockroach' | 'mysql' | 'mariadb' | 'mongodb';
    /** The name errors, metrics and banners use. */
    readonly driverName: string;
    /** SQLite and PostgreSQL: run fn inside BEGIN/COMMIT, ROLLBACK when it throws. */
    transaction?<T>(fn: () => Promise<T>): Promise<T>;

    /** Updates rows matching every field of `where` in one statement; resolves to how many changed. */
    updateWhere(table: string, values: Record<string, unknown>, where: Record<string, unknown>): Promise<number>;

    /** Resolves when the database answers (SELECT 1, or a ping on MongoDB). */
    ping(): Promise<void>;

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