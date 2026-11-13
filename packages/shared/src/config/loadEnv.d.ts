/** Loads .env, .env.<mode>, .env.local and .env.<mode>.local into process.env; the shell wins. */
export declare function loadEnv(baseDir?: string): Promise<void>;
/** The .env file that set `key`, or undefined (unset, or set in the shell). */
export declare function envSource(key: string): string | undefined;
/** The files loadEnv reads for a mode, highest precedence first. */
export declare function envFiles(mode: string): string[];
/** Parses .env text into [key, value, kind] entries. */
export declare function parseEnv(text: string): Array<[string, string, 'plain' | 'literal' | 'expand']>;
