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

export interface AppConfig {
    /** APP_NAME. Default "Tylix". */
    name: string;
    /** APP_ENV, else NODE_ENV. Default "development". */
    env: string;
    /** True when env is "production" or NODE_ENV=production. */
    production: boolean;
    /** APP_DEBUG: detailed error pages. Never in production. */
    debug: boolean;
    /** APP_URL: the public address, e.g. https://example.com. */
    url?: string;
}

export type CspMode = 'off' | 'report-only' | 'enforce';

export interface ServerConfig {
    /** PORT. Default 3000. */
    port: number;
    /** AUTO_PORT: try the next port when taken. Default on outside production. */
    autoPort: boolean;
    /** PORT_ATTEMPTS. Default 10. */
    portAttempts: number;
    /** TRUST_PROXY: believe X-Forwarded-* headers. Default false. */
    trustProxy: boolean;
    /** TRUSTED_ORIGINS (comma separated): other origins allowed to send writes. */
    trustedOrigins: string[];
    /** MAX_BODY_BYTES. Default 1 MB. */
    maxBodyBytes: number;
    csp: {
        /** CSP_MODE. Default report-only in production, off otherwise. */
        mode: CspMode;
        /** CSP_POLICY. Unset: the built-in policy. */
        policy?: string;
    };
}

export interface ChannelsConfig {
    /** CHANNELS_PORT. Default 6001. */
    port: number;
}

/** Where a setting's value came from. */
export interface SettingSource {
    from: 'default' | 'tylix.config' | 'environment' | string;
    /** The environment variable that sets it. */
    env?: string;
}

export interface TylixConfig {
    app: AppConfig;
    server: ServerConfig;
    channels: ChannelsConfig;
    /** For app.*, server.* and channels.* keys: where each value came from. */
    readonly sources: Record<string, SettingSource>;
    database: DatabaseConfig;
    auth: AuthConfig;
    mail: MailConfig;
    frontend: FrontendConfig;
    [key: string]: unknown;
}

/** What a tylix.config file may contain: every section is optional. */
export interface UserConfig {
    app?: Partial<Omit<AppConfig, 'production'>>;
    server?: Partial<Omit<ServerConfig, 'csp'>> & { csp?: Partial<ServerConfig['csp']> };
    channels?: Partial<ChannelsConfig>;
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