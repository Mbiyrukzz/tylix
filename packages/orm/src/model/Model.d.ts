// orm/src/model/Model.d.ts
import { QueryBuilder } from '../query/QueryBuilder.js';
import type { WhereClause } from '../query/types.js';

interface PaginateOptions {
    page?: number;
    limit?: number;
    where?: Record<string, unknown>;
}

interface PaginateResult<T> {
    data: T[];
    meta: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

type Row = Record<string, unknown>;

export declare class Model {
    static table: string | null;
    static fillable: string[];
    static timestamps: boolean;

    static getTable(): string;
    static getAdapter(): unknown;

    static all(): Promise<Row[]>;
    static query(): QueryBuilder<Row>;
    static where(field: string, value: unknown): QueryBuilder<Row>;
    static where(field: string, operator: WhereClause['operator'], value: unknown): QueryBuilder<Row>;
    static whereNull(field: string): QueryBuilder<Row>;
    static whereNotNull(field: string): QueryBuilder<Row>;
    static whereIn(field: string, values: readonly unknown[]): QueryBuilder<Row>;
    static whereNotIn(field: string, values: readonly unknown[]): QueryBuilder<Row>;
    static latest(column?: string): QueryBuilder<Row>;
    static oldest(column?: string): QueryBuilder<Row>;
    static paginate(options?: PaginateOptions): Promise<PaginateResult<Row>>;
    static find(id: number | string): Promise<Row | null>;
    static findOrFail(id: number | string): Promise<Row>;
    static create(data: Row): Promise<Row | null>;
    static update(id: number | string, data: Row): Promise<Row | null>;
    static delete(id: number | string): Promise<boolean>;
    static destroy(...ids: Array<number | string | Array<number | string>>): Promise<number>;

    static firstOrCreate(attributes: Row, values?: Row): Promise<Row | null>;
    static updateOrCreate(attributes: Row, values?: Row): Promise<Row | null>;

    static pluck(column: string): Promise<unknown[]>;
    static pluck(column: string, keyColumn: string): Promise<Record<string, unknown>>;
    static exists(): Promise<boolean>;

    static belongsTo(
        row: Row | null,
        foreignKey: string,
        RelatedModel: typeof Model,
    ): Promise<Row | null>;
    static hasMany(
        row: { id: number },
        RelatedModel: typeof Model,
        foreignKey: string,
    ): Promise<Row[]>;

    static first(): Promise<Row | null>;
    static count(): Promise<number>;
}