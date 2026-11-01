import type { WhereClause, QueryDescriptor } from './types.js';

export declare class QueryBuilder<TRow> {
    constructor(ModelClass: { getAdapter(): unknown; getTable(): string });

    where(field: string, value: unknown): this;
    where(field: string, operator: WhereClause['operator'], value: unknown): this;
    whereNull(field: string): this;
    whereNotNull(field: string): this;
    whereIn(field: string, values: readonly unknown[]): this;
    whereNotIn(field: string, values: readonly unknown[]): this;
    orderBy(field: string, direction?: 'ASC' | 'DESC'): this;
    latest(column?: string): this;
    oldest(column?: string): this;
    limit(value: number): this;
    offset(value: number): this;
    toDescriptor(): QueryDescriptor;

    get(): Promise<TRow[]>;
    first(): Promise<TRow | null>;
    count(): Promise<number>;
    pluck(column: string): Promise<unknown[]>;
    pluck(column: string, keyColumn: string): Promise<Record<string, unknown>>;
    exists(): Promise<boolean>;
}