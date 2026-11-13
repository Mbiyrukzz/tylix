// Traits: reusable model behaviour, as JavaScript mixins. A trait is a
// function that takes a model class and returns a class extending it:
//
//   export const SoftLabels = (Base) => class extends Base {
//     static async labelled(label) { return this.where('label', label).get() }
//   }
//
//   class Post extends use(Model, Searchable({ fields: ['title', 'body'] }), SoftLabels) {
//     static table = 'posts'
//   }
//
// A trait can bring observer hooks too: `static observers = [...]` on the
// class it returns runs alongside the model's own observers.

export function use(Base, ...traits) {
  return traits.reduce((Current, trait, i) => {
    if (typeof trait !== 'function') {
      throw new TypeError(`use(): trait ${i + 1} is not a function. Did you forget to call a trait factory, e.g. Searchable({ fields })?`)
    }
    const Next = trait(Current)
    if (typeof Next !== 'function' || !(Next === Current || Object.prototype.isPrototypeOf.call(Current, Next))) {
      throw new TypeError(`use(): trait ${i + 1} must return a class that extends the one it was given.`)
    }
    return Next
  }, Base)
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

// Adds Model.search(term) over the given columns:
//   class Post extends use(Model, Searchable({ fields: ['title', 'body'] })) {}
//   await Post.search('tylix')               // rows whose title or body contains it
//   await Post.search('tylix', { limit: 10 })
// Matching is case-insensitive (LIKE on every driver). It uses plain where()
// queries, one per field, so it works on SQLite, MySQL, PostgreSQL and
// MongoDB alike; for large tables use a full-text index instead.
export function Searchable(options = {}) {
  if (typeof options === 'function') {
    throw new TypeError('Searchable is a trait factory: call it with options, e.g. use(Model, Searchable({ fields: ["title"] })).')
  }
  const { fields } = options
  if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => IDENTIFIER.test(f))) {
    throw new TypeError('Searchable({ fields }) needs a list of column names, e.g. ["title", "body"].')
  }
  return (Base) =>
    class extends Base {
      static async search(term, { limit = 50 } = {}) {
        const text = String(term ?? '').trim()
        if (text === '') return []
        const pattern = `%${text}%`
        const found = new Map()
        for (const field of fields) {
          for (const row of await this.where(field, 'LIKE', pattern).get()) {
            if (!found.has(row.id)) found.set(row.id, row)
            if (found.size >= limit) return [...found.values()]
          }
        }
        return [...found.values()]
      }
    }
}
