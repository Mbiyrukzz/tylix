export type ValidationError = string | null

export interface RuleContext {
  /** The whole object being validated. */
  data: Record<string, unknown>
  /** The schema key of the field being checked. */
  field: string
}

/** Any rule: returns an error message, or null when the value passes. */
export interface RuleFn {
  (value: unknown, context: RuleContext): ValidationError | Promise<ValidationError>
  readonly ruleName?: string
}

// The brands below exist only in the types. They keep the rule kinds
// unrelated to each other, so TypeScript keeps every rule of a schema
// field (instead of merging them) and validate() can type its data.

/** A rule that also says what type a passing value has. */
export interface Rule<T> extends RuleFn {
  readonly __type: (value: T) => T
}
/** A rule that checks a value without saying anything about its type. */
export interface Check extends RuleFn {
  readonly __check: true
}
/** Makes the field required in validate()'s data. */
export interface RequiredRule extends RuleFn {
  readonly __required: true
}
/** Lets the field be null. */
export interface NullableRule extends RuleFn {
  readonly nullable: true
}

export declare const required: RequiredRule
export declare const nullable: NullableRule
export declare const isString: Rule<string>
export declare const isBoolean: Rule<boolean>
export declare const isInteger: Rule<number>
export declare const isNumber: Rule<number>
export declare const isArray: Rule<unknown[]>
export declare const isEmail: Rule<string>
export declare const isUrl: Rule<string>
export declare const isDate: Rule<string | Date>

export declare function minLength(n: number, message?: string): Check
export declare function maxLength(n: number, message?: string): Check
export declare function min(n: number, message?: string): Check
export declare function max(n: number, message?: string): Check
export declare function oneOf<const V extends readonly unknown[]>(values: V, message?: string): Rule<V[number]>
export declare function matches(pattern: RegExp, message?: string): Rule<string>
export declare function confirmed(otherField?: string, message?: string): Check

export interface UniqueModel {
  where(column: string, value: unknown): { where(column: string, operator: string, value: unknown): any; first(): Promise<unknown> }
}
export declare function unique(
  Model: UniqueModel,
  column?: string,
  options?: { ignore?: unknown | ((data: Record<string, unknown>) => unknown); message?: string },
): Check

export declare function withMessage<R extends RuleFn>(rule: R, message: string): R
