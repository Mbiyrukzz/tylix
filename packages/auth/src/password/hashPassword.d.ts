export declare const MAX_PASSWORD_BYTES: number
export declare function hashPassword(plainPassword: string): Promise<string>
/** Pass null/undefined as the hash for unknown accounts: the same work is done, so timing reveals nothing. */
export declare function verifyPassword(plainPassword: string, storedHash: string | null | undefined): Promise<boolean>
/** True when the hash uses an old format or weaker parameters: store a fresh hash after login. */
export declare function needsRehash(storedHash: string): boolean
