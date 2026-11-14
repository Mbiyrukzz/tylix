import { Model } from "@tylix/orm";
import { createHash, randomBytes } from "node:crypto";

const RESET_TOKEN_TTL_SECONDS = 60 * 60;
const RAW_TOKEN = /^[0-9a-f]{64}$/;

export interface PasswordResetAttributes {
    id: number;
    email: string;
    token_hash: string;
    expires_at: string;
    used_at: string | null;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class PasswordReset extends Model {
    static table = "password_resets";

    static fillable: string[] = ["email", "token_hash", "expires_at", "used_at"];

    // Only a hash is stored, so a database leak hands out no reset links.
    static hash(rawToken: string): string {
        return createHash("sha256").update(rawToken).digest("hex");
    }

    static async issue(email: string) {
        // Only the newest link works: older unused ones are retired first.
        await this.invalidateFor(email);

        const rawToken = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000);

        await this.create({
            email,
            token_hash: this.hash(rawToken),
            expires_at: expiresAt.toISOString(),
            used_at: null,
        });

        return { rawToken, expiresAt };
    }

    // One indexed lookup by hash (token_hash is unique), never a table scan.
    static async findValid(rawToken: string, email: string): Promise<PasswordResetAttributes | null> {
        if (typeof rawToken !== "string" || !RAW_TOKEN.test(rawToken)) return null;
        const record = (await this.query().where("token_hash", this.hash(rawToken)).first()) as PasswordResetAttributes | null;

        if (!record) return null;
        if (record.email !== email) return null;
        if (record.used_at) return null;
        if (new Date(record.expires_at).getTime() < Date.now()) return null;

        return record;
    }

    // Claims the token. Single use even when two requests race: only one
    // UPDATE can still match the original hash. Resolves true for the winner.
    static async consume(record: PasswordResetAttributes): Promise<boolean> {
        const changed = await this.updateWhere(
            { id: record.id, token_hash: record.token_hash },
            { token_hash: `used:${record.token_hash}`, used_at: new Date().toISOString() },
        );
        return changed === 1;
    }

    static async invalidateFor(email: string): Promise<void> {
        const open = (await this.query().where("email", email).whereNull("used_at").get()) as PasswordResetAttributes[];
        for (const record of open) await this.consume(record);
    }

    // Kept for controllers generated before consume() existed.
    static async markUsed(id: number) {
        return this.update(id, { used_at: new Date().toISOString() });
    }
}
