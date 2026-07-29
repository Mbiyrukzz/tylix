import type { DatabaseAdapter } from '../adapters/DatabaseAdapter.js';

export declare const ConnectionManager: {
    setAdapter(adapter: DatabaseAdapter): void;
    getAdapter(): DatabaseAdapter;
    reset(): void;
};