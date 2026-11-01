export interface DatabaseConfig {
    driver: string;
    filename?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    url?: string;
    [key: string]: unknown;
}

export interface AuthConfig {
    secret: string;
    tokenExpiresInSeconds: number;
}

export interface MailConfig {
    driver: string;
    from: string;
    host: string;
    port: number;
    user: string;
    password: string;
    secure: boolean;
}

export interface TylixConfig {
    database: DatabaseConfig;
    auth: AuthConfig;
    mail: MailConfig;
    [key: string]: unknown;
}

export declare function loadConfig(
    cwd?: string,
    language?: 'javascript' | 'typescript'
): Promise<TylixConfig>;