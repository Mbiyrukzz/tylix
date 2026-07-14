/**
 * Minimal fine-grained reactivity core (Proxy get/set + dependency
 * tracking), the same fundamental technique Vue 3 and Solid use to
 * avoid virtual-DOM diffing entirely. An effect() records which
 * reactive properties it read; reactive() re-runs exactly the effects
 * that depend on a property when that property is written — nothing
 * else re-renders.
 */

let activeEffect = null;
const targetMap = new WeakMap();

export function reactive(target) {
  return new Proxy(target, {
    get(obj, key, receiver) {
      track(obj, key);
      return Reflect.get(obj, key, receiver);
    },
    set(obj, key, value, receiver) {
      const changed = obj[key] !== value;
      const result = Reflect.set(obj, key, value, receiver);
      if (changed) trigger(obj, key);
      return result;
    },
  });
}

function track(obj, key) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(obj);
  if (!depsMap) targetMap.set(obj, (depsMap = new Map()));
  let dep = depsMap.get(key);
  if (!dep) depsMap.set(key, (dep = new Set()));
  dep.add(activeEffect);
}

function trigger(obj, key) {
  const depsMap = targetMap.get(obj);
  if (!depsMap) return;
  const dep = depsMap.get(key);
  if (!dep) return;
  // Copy before iterating: an effect may re-track (add/remove itself)
  // while running, which would corrupt the Set mid-iteration.
  [...dep].forEach((fn) => fn());
}

export function effect(fn) {
  const wrapped = () => {
    const previousEffect = activeEffect;
    activeEffect = wrapped;
    try {
      fn();
    } finally {
      activeEffect = previousEffect;
    }
  };
  wrapped();
  return wrapped;
}
