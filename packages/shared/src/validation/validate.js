// Checks data against a schema of rules per field:
//
//   const result = validate(req.body, {
//     title: [required, isString, maxLength(200)],
//     'address.city': [isString],          // nested fields by dot path
//   })
//   if (!result.valid) return res.status(422).json({ errors: result.errors })
//   await Post.create(result.data)
//
// errors holds one message per failing field (the first rule that fails),
// keyed by the schema's field names. data holds only the fields the schema
// declares, so nothing else a client sends gets through.
//
// validate() is synchronous; a schema with asynchronous rules (unique())
// needs validateAsync(), which returns a Promise of the same result.

function readPath(data, field) {
  if (!field.includes('.')) return data?.[field]
  let current = data
  for (const key of field.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

function writePath(target, field, value) {
  const keys = field.split('.')
  let current = target
  for (const key of keys.slice(0, -1)) {
    if (current[key] === null || typeof current[key] !== 'object') current[key] = {}
    current = current[key]
  }
  current[keys.at(-1)] = value
}

const isBlank = (value) => value === undefined || value === null || value === ''

function checkSchema(schema) {
  if (schema === null || typeof schema !== 'object') throw new TypeError('validate(data, schema) needs a schema object.')
  for (const [field, rules] of Object.entries(schema)) {
    const factory = Array.isArray(rules) && rules.find((rule) => rule?.isRuleFactory)
    if (factory) {
      throw new TypeError(`validate(): ${factory.name} for "${field}" needs calling, e.g. ${factory.name}(8) or ${factory.name}([...]).`)
    }
    if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== 'function')) {
      throw new TypeError(
        `validate(): the rules for "${field}" must be a list of rule functions, e.g. [required, isString]. ` +
          'Factories like minLength need calling: minLength(8).',
      )
    }
  }
}

// Each field with its value and the rules that apply to it.
function* fields(data, schema) {
  for (const [field, rules] of Object.entries(schema)) {
    const value = readPath(data, field)
    const nullable = rules.some((rule) => rule.nullable)
    const isRequired = rules.some((rule) => rule.ruleName === 'required')
    // Optional and absent, or null where null is allowed: nothing to check.
    const skip = (nullable && value === null) || (!isRequired && isBlank(value))
    yield { field, value, rules: skip ? [] : rules, keep: value !== undefined }
  }
}

function finish(entries) {
  const errors = {}
  const data = {}
  for (const { field, value, error, keep } of entries) {
    if (error) errors[field] = [error]
    else if (keep) writePath(data, field, value)
  }
  return { valid: Object.keys(errors).length === 0, errors, data }
}

export function validate(input, schema) {
  checkSchema(schema)
  const data = input ?? {}
  const entries = []
  for (const entry of fields(data, schema)) {
    let error = null
    for (const rule of entry.rules) {
      const result = rule(entry.value, { data, field: entry.field })
      if (result && typeof result.then === 'function') {
        throw new Error(`validate(): a rule for "${entry.field}" is asynchronous (like unique()); use validateAsync().`)
      }
      if (result) {
        error = result
        break
      }
    }
    entries.push({ ...entry, error })
  }
  return finish(entries)
}

export async function validateAsync(input, schema) {
  checkSchema(schema)
  const data = input ?? {}
  const entries = await Promise.all(
    [...fields(data, schema)].map(async (entry) => {
      for (const rule of entry.rules) {
        const error = await rule(entry.value, { data, field: entry.field })
        if (error) return { ...entry, error }
      }
      return { ...entry, error: null }
    }),
  )
  return finish(entries)
}

// The first message of a result, or '' when it passed. For forms that show
// one message at a time:  setError(firstError(validateLogin(form)))
export function firstError(result) {
  for (const messages of Object.values(result?.errors ?? {})) {
    if (messages?.length) return messages[0]
  }
  return ''
}
