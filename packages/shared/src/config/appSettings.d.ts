import type { AppConfig, ChannelsConfig, ObservabilityConfig, ServerConfig, StoreConfig, SettingSource, UserConfig } from './loadConfig.js';
export declare const LOG_LEVELS: readonly ['debug', 'info', 'warn', 'error', 'silent'];
export declare const CSP_MODES: readonly ['off', 'report-only', 'enforce'];
export declare function resolveAppSettings(
    userConfig?: UserConfig,
    sources?: Record<string, SettingSource>,
): { app: AppConfig; server: ServerConfig; channels: ChannelsConfig; observability: ObservabilityConfig; store: StoreConfig };
