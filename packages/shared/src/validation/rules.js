// Validation rules. A rule is a function (value, { data, field }) that
// returns an error message, or null when the value passes. It may return a
// Promise (see unique()), which validateAsync() waits for.
//
// Rules other than required() pass when the value is missing (undefined or
// null), so a field without required() is optional. validate() also skips
// an optional field's rules when it is an empty string.
//
// Plain rules are used as-is: [required, isString]. Rules that need a
// setting are factories: [minLength(8), oneOf(['draft', 'published'])].
// Every factory takes an optional custom message as its last argument;
// withMessage(rule, '...') does the same for plain rules.
//
// This module has no Node imports, so the same rules run in the browser
// (import from '@tylix/shared/validation').

const missing = (value) => value === undefined || value === null

// Gives a rule a name (for messages and debugging) and returns it.
function named(name, rule) {
  Object.defineProperty(rule, 'ruleName', { value: name })
  return rule
}

const lengthOf = (value) => (typeof value === 'string' || Array.isArray(value) ? value.length : null)

export const required = named('required', (value) => {
  if (missing(value) || value === '' || (Array.isArray(value) && value.length === 0)) {
    return 'This field is required.'
  }
  return null
})

// Marks a field that may be null: when it is, its other rules are skipped
// and null is kept in the validated data.
export const nullable = named('nullable', () => null)
nullable.nullable = true

export const isString = named('isString', (value) =>
  missing(value) || typeof value === 'string' ? null : 'This field must be a string.',
)

export const isBoolean = named('isBoolean', (value) =>
  missing(value) || typeof value === 'boolean' ? null : 'This field must be true or false.',
)

export const isInteger = named('isInteger', (value) =>
  missing(value) || Number.isInteger(value) ? null : 'This field must be a whole number.',
)

export const isNumber = named('isNumber', (value) =>
  missing(value) || (typeof value === 'number' && Number.isFinite(value)) ? null : 'This field must be a number.',
)

export const isArray = named('isArray', (value) =>
  missing(value) || Array.isArray(value) ? null : 'This field must be a list.',
)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isEmail = named('isEmail', (value) => {
  if (missing(value)) return null
  return typeof value === 'string' && EMAIL.test(value) ? null : 'This field must be a valid email address.'
})

export const isUrl = named('isUrl', (value) => {
  if (missing(value)) return null
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:') return null
    } catch {
      // not a URL
    }
  }
  return 'This field must be a valid http(s) URL.'
})

// A date or date-time string (2026-11-13, 2026-11-13T09:30:00Z) or a Date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export const isDate = named('isDate', (value) => {
  if (missing(value)) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'This field must be a valid date.' : null
  if (typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return null
  return 'This field must be a valid date (YYYY-MM-DD).'
})

// Characters for strings, items for lists.
export function minLength(n, message) {
  return named('minLength', (value) => {
    const length = lengthOf(value)
    if (length === null || length >= n) return null
    return message ?? (Array.isArray(value) ? `Choose at least ${n}.` : `This field must be at least ${n} characters.`)
  })
}

export function maxLength(n, message) {
  return named('maxLength', (value) => {
    const length = lengthOf(value)
    if (length === null || length <= n) return null
    return message ?? (Array.isArray(value) ? `Choose at most ${n}.` : `This field must be at most ${n} characters.`)
  })
}

export function min(n, message) {
  return named('min', (value) =>
    typeof value !== 'number' || value >= n ? null : (message ?? `This field must be at least ${n}.`),
  )
}

export function max(n, message) {
  return named('max', (value) =>
    typeof value !== 'number' || value <= n ? null : (message ?? `This field must be at most ${n}.`),
  )
}

export function oneOf(values, message) {
  const allowed = [...values]
  return named('oneOf', (value) =>
    missing(value) || allowed.includes(value) ? null : (message ?? `This field must be one of: ${allowed.join(', ')}.`),
  )
}

export function matches(pattern, message = 'This field has an invalid format.') {
  if (!(pattern instanceof RegExp)) throw new TypeError('matches(pattern) needs a regular expression.')
  return named('matches', (value) => {
    if (missing(value)) return null
    pattern.lastIndex = 0 // a /g pattern keeps state between tests
    return typeof value === 'string' && pattern.test(value) ? null : message
  })
}

// The value must equal another field, by default <field>_confirmation:
//   password: [required, minLength(8), confirmed()]
export function confirmed(otherField, message = 'The confirmation does not match.') {
  return named('confirmed', (value, context = {}) => {
    if (missing(value)) return null
    const other = otherField ?? `${context.field}_confirmation`
    return context.data?.[other] === value ? null : message
  })
}

// No other row may have this value. Takes a model with where(), e.g. User:
//   email: [required, isEmail, unique(User)]
//   email: [unique(User, 'email', { ignore: (data) => data.id })]   on update
// Asynchronous: use validateAsync().
export function unique(Model, column, { ignore, message = 'This value is already taken.' } = {}) {
  if (typeof Model?.where !== 'function') throw new TypeError('unique(Model) needs a model class, e.g. unique(User).')
  return named('unique', async (value, context = {}) => {
    if (missing(value) || value === '') return null
    let query = Model.where(column ?? context.field, value)
    const ignoreId = typeof ignore === 'function' ? ignore(context.data ?? {}) : ignore
    if (ignoreId !== undefined && ignoreId !== null) query = query.where('id', '!=', ignoreId)
    return (await query.first()) ? message : null
  })
}

// Replaces a rule's message: withMessage(required, 'Tell us your name.').
export function withMessage(rule, message) {
  const wrapped = (value, context) => {
    const result = rule(value, context)
    if (result && typeof result.then === 'function') return result.then((error) => (error ? message : null))
    return result ? message : null
  }
  if (rule.nullable) wrapped.nullable = true
  return named(rule.ruleName ?? 'custom', wrapped)
}

// Tagged so validate() can say "call it" when one is used uncalled:
// [minLength] instead of [minLength(8)].
for (const factory of [minLength, maxLength, min, max, oneOf, matches, confirmed, unique, withMessage]) {
  Object.defineProperty(factory, 'isRuleFactory', { value: true })
}
