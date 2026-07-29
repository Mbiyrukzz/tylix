import type { ValidationError } from './rules.js';

export type ValidationRule = (value: unknown) => ValidationError;

export interface ValidationResult {
    valid: boolean;
    errors: Record<string, string[]>;
}

export declare function validate(
    data: Record<string, unknown>,
    schema: Record<string, ValidationRule[]>
): ValidationResult;