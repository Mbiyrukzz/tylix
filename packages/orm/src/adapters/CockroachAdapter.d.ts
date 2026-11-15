import { PostgresAdapter } from './PostgresAdapter.js';
export declare class CockroachAdapter extends PostgresAdapter {
    constructor(config?: { connectionString?: string; host?: string; port?: number; user?: string; password?: string; database?: string; ssl?: boolean | object });
}
