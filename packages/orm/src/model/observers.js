// Model observers: code that runs when rows are created, updated or deleted.
//
//   class UserObserver {
//     async created(user) { await dispatch('SendWelcomeEmail', { userId: user.id }) }
//   }
//   class User extends Model {
//     static observers = [UserObserver]
//   }
//
// Hooks (all optional, may be async):
//   creating(data)            before an insert; return an object to replace
//                             the data, or throw to cancel
//   created(row)              after the insert
//   updating(data, before)    before an update (before = current row);
//                             return an object to replace the data, or throw
//   updated(row, before)      after the update
//   deleting(row)             before a delete; throw to cancel
//   deleted(row)              after the delete
//
// Every hook also gets the model class as its last argument.
//
// Observers come from `static observers` on the model and on every class it
// extends (so traits can bring their own), plus Model.observe(...) calls.
// An observer is a class (created once and reused) or a plain object.

export const OBSERVER_EVENTS = ['creating', 'created', 'updating', 'updated', 'deleting', 'deleted']

// Model class -> observers added at runtime with Model.observe().
const registered = new WeakMap()
// Observer class -> its single instance.
const instances = new WeakMap()

function instantiate(observer) {
  if (typeof observer === 'function') {
    if (!instances.has(observer)) instances.set(observer, new observer())
    return instances.get(observer)
  }
  if (observer && typeof observer === 'object') return observer
  throw new TypeError('An observer must be a class or an object with hook methods.')
}

export function addObservers(Model, observers) {
  for (const observer of observers) instantiate(observer) // validate early
  registered.set(Model, [...(registered.get(Model) ?? []), ...observers])
}

// Every observer for a model: its parents' first, then its own.
export function observersOf(Model) {
  const chain = []
  for (let current = Model; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
    chain.unshift(current)
  }
  const list = []
  for (const cls of chain) {
    if (Object.hasOwn(cls, 'observers')) {
      if (!Array.isArray(cls.observers)) {
        throw new TypeError(`${cls.name}.observers must be an array of observers.`)
      }
      list.push(...cls.observers)
    }
    list.push(...(registered.get(cls) ?? []))
  }
  return list.map(instantiate)
}

// Runs one event's hooks in order. For "creating"/"updating", a hook may
// return a new data object, which the next hook (and the write) receives.
export async function fire(Model, observers, event, data, ...rest) {
  let current = data
  for (const observer of observers) {
    const hook = observer[event]
    if (typeof hook !== 'function') continue
    const result = await hook.call(observer, current, ...rest, Model)
    if ((event === 'creating' || event === 'updating') && result && typeof result === 'object') {
      current = result
    }
  }
  return current
}

export function hasHook(observers, events) {
  return observers.some((observer) => events.some((event) => typeof observer[event] === 'function'))
}
