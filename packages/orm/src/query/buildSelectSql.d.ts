import type { QueryDescriptor } from './types.js';

export interface BuiltSelect {
    sql: string;
    params: unknown[];
}

export declare function buildSelectSql(
    table: string,
    descriptor?: QueryDescriptor
): BuiltSelect;