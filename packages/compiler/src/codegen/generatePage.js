import { generateMethod } from "./generateMethod.js";

/**
 * Compiles a full PageNode into JS source defining a component class.
 * - state entries become reactive-backed getter/setter pairs, so
 *   `this.count` reads/writes go through the reactive() proxy and
 *   correctly trigger dependent effects (template re-renders, computed
 *   re-evaluation) without any special-casing in the method codegen.
 * - computed entries become plain getters (their body already contains
 *   a `return` statement from the parser).
 * - action entries become plain instance methods.
 *
 * The generated class expects `reactive` to be in scope where the
 * module is evaluated (imported from @tylix/compiler's runtime).
 */
export function generatePage(pageNode, className = "Page") {
  const stateInit = pageNode.state
    .map((s) => `      ${s.name}: ${JSON.stringify(s.value.value)},`)
    .join("\n");

  const stateAccessors = pageNode.state
    .map(
      (s) => `  get ${s.name}() {
    return this.__state.${s.name};
  }
  set ${s.name}(value) {
    this.__state.${s.name} = value;
  }`
    )
    .join("\n\n");

  const computedGetters = pageNode.computed
    .map((c) => {
      const body = c.body.map((stmt) => `    ${statementSource(stmt)}`).join("\n");
      return `  get ${c.name}() {\n${body}\n  }`;
    })
    .join("\n\n");

  const actionMethods = pageNode.actions.map((a) => generateMethod(a)).join("\n\n");

  const onMountCall = pageNode.onMount
    ? `    this.__onMount();\n`
    : "";

  const onMountMethod = pageNode.onMount
    ? (() => {
        const body = pageNode.onMount.body.map((stmt) => `    ${statementSource(stmt)}`).join("\n");
        const asyncPrefix = pageNode.onMount.isAsync ? "async " : "";
        return `  ${asyncPrefix}__onMount() {\n${body}\n  }`;
      })()
    : "";

  return `class ${className} {
  constructor() {
    this.__state = reactive({
${stateInit}
    });
${onMountCall}  }

${[stateAccessors, computedGetters, actionMethods, onMountMethod].filter(Boolean).join("\n\n")}
}`;
}

// Local import kept separate from generateMethod's own statement
// formatting so computed getters and state accessors can share the
// same statement codegen without generateMethod's parameter handling.
import { generateStatement } from "./generateStatement.js";
function statementSource(stmt) {
  return generateStatement(stmt);
}
