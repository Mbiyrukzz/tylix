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
    /** WORKERS: processes "tylix start" runs, sharing the port; "auto" is one per CPU core. Default 1. */
    workers: number | 'auto';
    /** MAX_BODY_BYTES. Default 1 MB. */
    maxBodyBytes: number;
    csp: {
        /** CSP_MODE. Default report-only in production, off otherwise. */
        mode: CspMode;
        /** CSP_POLICY. Unset: the built-in policy. */
        policy?: string;
    };
}

export interface ObservabilityConfig {
    /** LOG_LEVEL. Default info. */
    logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
    /** LOG_FORMAT. Default json in production, pretty otherwise. */
    logFormat: 'json' | 'pretty';
    /** ACCESS_LOG: one line per request; "api" logs only /api/. Default true in production, "api" otherwise. */
    accessLog: boolean | 'api';
    /** SLOW_REQUEST_MS: slower requests are logged as warnings; 0 turns it off. Default 1000. */
    slowRequestMs: number;
    /** SLOW_QUERY_MS: slower SQL is logged as a warning; 0 turns it off. Default 200. */
    slowQueryMs: number;
    /** METRICS: Prometheus metrics at /metrics. Default false. */
    metrics: boolean;
    /** METRICS_TOKEN: required as a bearer token for /metrics when set. */
    metricsToken?: string;
}

export interface StoreConfig {
    /** STORE_DRIVER: where rate limits, the cache and channel messages live. Default database. */
    driver: 'memory' | 'database' | 'redis';
    /** REDIS_URL. Default redis://127.0.0.1:6379. */
    redisUrl: string;
    /** STORE_PREFIX: put in front of every key. Default "<app name>:". */
    prefix: string;
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
    observability: ObservabilityConfig;
    store: StoreConfig;
    /** For app.*, server.*, channels.* and observability.* keys: where each value came from. */
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
    observability?: Partial<ObservabilityConfig>;
    store?: Partial<StoreConfig>;
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