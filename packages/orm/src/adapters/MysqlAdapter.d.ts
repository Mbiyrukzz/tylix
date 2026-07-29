import { DatabaseAdapter } from './DatabaseAdapter.js';

export interface MysqlAdapterOptions {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
}

export declare class MysqlAdapter extends DatabaseAdapter {
    constructor(options?: MysqlAdapterOptions);
}

export declare function toMysqlDateTime(value: unknown): unknown;