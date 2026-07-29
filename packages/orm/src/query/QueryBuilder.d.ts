import type { WhereClause, QueryDescriptor } from './types.js';

export declare class QueryBuilder<TRow> {
    constructor(ModelClass: { getAdapter(): unknown; getTable(): string });

    where(field: string, value: unknown): this;
    where(field: string, operator: WhereClause['operator'], value: unknown): this;
    orderBy(field: string, direction?: 'ASC' | 'DESC'): this;
    limit(value: number): this;
    offset(value: number): this;
    toDescriptor(): QueryDescriptor;

    get(): Promise<TRow[]>;
    first(): Promise<TRow | null>;
    count(): Promise<number>;
}