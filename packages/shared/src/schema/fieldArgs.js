// Field arguments on the command line:
//
//   title:string                 a column
//   slug:string:unique           unique index
//   status:string:index:default=draft
//   bio:text:required            NOT NULL
//   views:integer:default=0
//   user_id:integer:index:system
//
// Modifiers after the type, in any order: unique, index, required (NOT
// NULL), nullable, system, default=<value>.

const FLAGS = new Set(['unique', 'index', 'required', 'nullable', 'system'])

function parseDefault(raw) {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

export function parseFieldArg(arg) {
  const [name, type = 'string', ...modifiers] = String(arg).split(':')
  const field = { name, type }
  for (const modifier of modifiers) {
    if (!modifier) continue
    if (modifier.startsWith('default=')) {
      field.default = parseDefault(modifier.slice('default='.length))
      continue
    }
    if (!FLAGS.has(modifier)) {
      throw new Error(`Unknown modifier "${modifier}" on field "${name}". Use: ${[...FLAGS].join(', ')}, default=<value>.`)
    }
    if (modifier === 'required') field.nullable = false
    else if (modifier === 'nullable') field.nullable = true
    else field[modifier] = true
  }
  return field
}

// The schema-builder chain for a field: .notNullable().default("x").unique()
export function columnModifiers(field) {
  let out = ''
  if (field.nullable === false) out += '.notNullable()'
  if (field.default !== undefined) out += `.default(${JSON.stringify(field.default)})`
  if (field.unique) out += '.unique()'
  else if (field.index) out += '.index()'
  return out
}
