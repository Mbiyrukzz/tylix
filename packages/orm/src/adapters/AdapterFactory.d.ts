import type { DatabaseAdapter } from './DatabaseAdapter.js';

export interface DatabaseConfig {
    driver: 'sqlite' | 'postgres' | 'cockroach' | 'mysql' | 'mariadb' | 'mongodb';
    [key: string]: unknown;
}

export declare function createAdapter(databaseConfig: DatabaseConfig): DatabaseAdapter;