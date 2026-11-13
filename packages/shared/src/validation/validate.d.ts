import type { NullableRule, RequiredRule, RuleFn } from './rules.js'

/** Kept for older code: a rule as a plain function. */
export type ValidationRule = RuleFn | ((value: unknown) => string | null)

export type ValidationSchema = Record<string, readonly ValidationRule[]>

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never
// Each rule's type is boxed before intersecting: a bare union with unknown
// would collapse to unknown first ({ t: unknown } & { t: string } is string).
type Boxed<R> = R extends { readonly __type: (value: infer T) => unknown } ? { t: T } : { t: unknown }
type FieldType<Rules extends readonly unknown[]> =
  | (UnionToIntersection<Boxed<Rules[number]>> extends { t: infer T } ? T : unknown)
  | ([Extract<Rules[number], NullableRule>] extends [never] ? never : null)
type RequiredKeys<S extends ValidationSchema> = {
  [K in keyof S]: [Extract<S[K][number], RequiredRule>] extends [never] ? never : K
}[keyof S]

/** The shape of validate()'s data for a schema (dot-path keys stay flat). */
export type Validated<S extends ValidationSchema> = { [K in RequiredKeys<S>]: FieldType<S[K]> } & {
  [K in Exclude<keyof S, RequiredKeys<S>>]?: FieldType<S[K]>
}

export interface ValidationResult<T = Record<string, unknown>> {
  valid: boolean
  /** One message per failing field. */
  errors: Record<string, string[]>
  /** Only the fields the schema declares. */
  data: T
}

export declare function validate<S extends ValidationSchema>(data: unknown, schema: S): ValidationResult<Validated<S>>
export declare function validateAsync<S extends ValidationSchema>(data: unknown, schema: S): Promise<ValidationResult<Validated<S>>>

/** The first message of a result, or '' when it passed. */
export declare function firstError(result: { errors?: Record<string, string[]> } | null | undefined): string
