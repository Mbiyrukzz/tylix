export interface DatabaseConfig {
    driver: string;
    filename?: string;
    [key: string]: unknown;
}

export interface AuthConfig {
    secret: string;
    tokenExpiresInSeconds: number;
}

export interface TylixConfig {
    database: DatabaseConfig;
    auth: AuthConfig;
    [key: string]: unknown;
}

export declare function loadConfig(
    cwd?: string,
    language?: 'javascript' | 'typescript'
): Promise<TylixConfig>;