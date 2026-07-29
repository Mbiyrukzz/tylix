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

    static all<T extends typeof Model>(this: T): Promise<InstanceType<T>[]>;
    static query<T extends typeof Model>(this: T): QueryBuilder<InstanceType<T>>;
    static paginate<T extends typeof Model>(
        this: T,
        options?: PaginateOptions,
    ): Promise<PaginateResult<InstanceType<T>>>;
    static find<T extends typeof Model>(this: T, id: number): Promise<InstanceType<T> | null>;
    static create<T extends typeof Model>(
        this: T,
        data: Record<string, unknown>,
    ): Promise<InstanceType<T> | null>;
    static update<T extends typeof Model>(
        this: T,
        id: number,
        data: Record<string, unknown>,
    ): Promise<InstanceType<T> | null>;
    static delete(id: number): Promise<boolean>;

    static belongsTo<T extends typeof Model>(
        row: Record<string, unknown> | null,
        foreignKey: string,
        RelatedModel: T,
    ): Promise<InstanceType<T> | null>;
    static hasMany<T extends typeof Model>(
        row: { id: number },
        RelatedModel: T,
        foreignKey: string,
    ): Promise<InstanceType<T>[]>;

    static first<T extends typeof Model>(this: T): Promise<InstanceType<T> | null>;
    static count(): Promise<number>;
}