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

export type FrontendDriver = 'tylix' | 'react' | 'svelte' | 'vue' | 'angular';

export interface FrontendConfig {
    /** Which frontend renders pages. Default "tylix" (native .tyx pages). */
    driver: FrontendDriver;
    /** Server-side rendering, for hosted frontends. Default false. */
    ssr: boolean;
    /** Page paths guests are redirected away from, e.g. ["/dashboard/**"]. */
    protected: string[];
    /** Where those guests are sent, with ?next=. Default "/login". */
    loginPath: string;
    /** Extra Vite config for hosted frontends, merged last. */
    vite: Record<string, unknown>;
}

export interface TylixConfig {
    database: DatabaseConfig;
    auth: AuthConfig;
    mail: MailConfig;
    frontend: FrontendConfig;
    [key: string]: unknown;
}

/** What a tylix.config file may contain: every section is optional. */
export interface UserConfig {
    database?: Partial<DatabaseConfig>;
    auth?: Partial<AuthConfig> & Record<string, unknown>;
    mail?: Partial<MailConfig>;
    frontend?: Partial<FrontendConfig>;
    [key: string]: unknown;
}

export declare const FRONTEND_DRIVERS: FrontendDriver[];

/** Fills in frontend defaults and validates every field; throws on a mistake. */
export declare function resolveFrontendConfig(frontend?: Partial<FrontendConfig>): FrontendConfig;

/** Types a tylix.config file: export default defineConfig({ ... }) */
export declare function defineConfig<T extends UserConfig>(config: T): T;

export declare function loadConfig(
    cwd?: string,
    language?: 'javascript' | 'typescript'
): Promise<TylixConfig>;