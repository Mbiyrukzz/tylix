import type { AppConfig, ChannelsConfig, ServerConfig, SettingSource, UserConfig } from './loadConfig.js';
export declare const CSP_MODES: readonly ['off', 'report-only', 'enforce'];
export declare function resolveAppSettings(
    userConfig?: UserConfig,
    sources?: Record<string, SettingSource>,
): { app: AppConfig; server: ServerConfig; channels: ChannelsConfig };
