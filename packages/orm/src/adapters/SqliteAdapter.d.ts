import { DatabaseAdapter } from './DatabaseAdapter.js';

export interface SqliteAdapterOptions {
    filename?: string;
}

export declare class SqliteAdapter extends DatabaseAdapter {
    constructor(options?: SqliteAdapterOptions);
}