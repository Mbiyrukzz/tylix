export type DatabaseDriver = 'mysql' | 'postgres' | 'sqlite' | 'mongodb';

export type DatabaseErrorKind =
    | 'connection_failed'
    | 'auth_failed'
    | 'unknown_database'
    | 'missing_table'
    | 'missing_column'
    | 'duplicate_key'
    | 'not_null'
    | 'foreign_key'
    | 'data_too_long'
    | 'syntax'
    | 'unsupported_query'
    | 'driver_missing'
    | 'unknown';

export interface DatabaseErrorOptions {
    driver?: DatabaseDriver | null;
    kind?: DatabaseErrorKind;
    title?: string | null;
    hint?: string | null;
    code?: string | number | null;
    detail?: string | null;
    table?: string | null;
    column?: string | null;
    sql?: string | null;
    params?: unknown[];
    cause?: unknown;
}

export declare class DatabaseError extends Error {
    constructor(message: string, options?: DatabaseErrorOptions);
    driver: DatabaseDriver | null;
    kind: DatabaseErrorKind;
    title: string | null;
    hint: string | null;
    code: string | number | null;
    detail: string | null;
    table: string | null;
    column: string | null;
    sql: string | null;
    params: unknown[];
    cause: unknown;
    toJSON(): Record<string, unknown>;
}

export declare function normalizeDatabaseError(
    driver: DatabaseDriver,
    err: unknown,
    context?: { sql?: string | null; params?: unknown[] },
): DatabaseError;