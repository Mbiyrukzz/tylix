import { generateExpression } from './generateExpression.js'
import { generateStatement } from './generateStatement.js'
import { generateMethod } from './generateMethod.js'

/**
 * Compiles a capability AST (see Parser.parseCapability) into a
 * defineCapability(name, def) call.
 *
 * Unlike generatePage's class output, there's no reactive() wrapping
 * here and no accessor pairs -- resolveCapability (runtime/capability.js)
 * handles wrapping entry.def.state in reactive() itself on first
 * resolution, so state is emitted as a plain object literal, and
 * actions/init are emitted as plain (unbound) methods that
 * resolveCapability binds to the reactive instance at resolve time.
 *
 * action entries reuse generateMethod as-is -- its `name(params) {
 * body }` output is valid both as a class method (generatePage's use)
 * and as ES6 object-method shorthand (this file's use), so there's no
 * need for a second, parallel method-body codegen path here.
 */
export function generateCapability(capabilityNode) {
  const stateProps = capabilityNode.state
    .map((s) => `    ${s.name}: ${generateExpression(s.value)},`)
    .join('\n')

  const actionMethods = capabilityNode.actions
    .map((a) => `  ${generateMethod(a)},`)
    .join('\n')

  const initMethod = capabilityNode.init
    ? (() => {
        const body = capabilityNode.init.body
          .map((stmt) => `      ${generateStatement(stmt)}`)
          .join('\n')
        const asyncPrefix = capabilityNode.init.isAsync ? 'async ' : ''
        return `  ${asyncPrefix}init() {\n${body}\n  },`
      })()
    : ''

  return `defineCapability(${JSON.stringify(capabilityNode.name)}, {
  state: {
${stateProps}
  },
  actions: {
${actionMethods}
  },
${initMethod}
});`
}
