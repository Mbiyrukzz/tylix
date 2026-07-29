import type { DatabaseAdapter } from './DatabaseAdapter.js';

export interface DatabaseConfig {
    driver: 'sqlite' | 'postgres' | 'mysql' | 'mongodb';
    [key: string]: unknown;
}

export declare function createAdapter(databaseConfig: DatabaseConfig): DatabaseAdapter;