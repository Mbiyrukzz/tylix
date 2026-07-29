// orm/src/model/Model.d.ts
import { QueryBuilder } from '../query/QueryBuilder.js';

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

export declare class Model {
    static table: string | null;
    static fillable: string[];
    static timestamps: boolean;

    static getTable(): string;
    static getAdapter(): unknown;

    static all(): Promise<Record<string, unknown>[]>;
    static query(): QueryBuilder<Record<string, unknown>>;
    static paginate(options?: PaginateOptions): Promise<PaginateResult<Record<string, unknown>>>;
    static find(id: number | string): Promise<Record<string, unknown> | null>;
    static create(data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    static update(id: number | string, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    static delete(id: number | string): Promise<boolean>;

    static belongsTo(
        row: Record<string, unknown> | null,
        foreignKey: string,
        RelatedModel: typeof Model,
    ): Promise<Record<string, unknown> | null>;
    static hasMany(
        row: { id: number },
        RelatedModel: typeof Model,
        foreignKey: string,
    ): Promise<Record<string, unknown>[]>;

    static first(): Promise<Record<string, unknown> | null>;
    static count(): Promise<number>;
}