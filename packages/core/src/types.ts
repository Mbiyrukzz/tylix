
import type { IncomingMessage, ServerResponse } from "node:http";

export interface AuthTokenPayload {
    userId: number;
    /** Present only if signToken() included an expiry (most tokens do). */
    exp?: number;
    [key: string]: unknown;
}

export interface TylixRequest extends IncomingMessage {
    params: Record<string, string>;
    query: Record<string, string>;
    cookies: Record<string, string>;
    body: unknown;
    /** Set by requireAuth() from the verified token's payload. */
    user?: AuthTokenPayload;
}

export interface TylixResponse extends ServerResponse {
    status(code: number): TylixResponse;
    json(data: unknown): void;
    send(data?: unknown): TylixResponse;
    cookie(name: string, value: string, options?: Record<string, unknown>): TylixResponse;
    clearCookie(name: string, options?: Record<string, unknown>): TylixResponse;
}