export type ValidationError = string | null;

export declare function required(value: unknown): ValidationError;
export declare function isString(value: unknown): ValidationError;
export declare function isBoolean(value: unknown): ValidationError;
export declare function isInteger(value: unknown): ValidationError;
export declare function isEmail(value: unknown): ValidationError;