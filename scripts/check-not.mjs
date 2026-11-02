import { parseExpressionString } from '../packages/compiler/src/parser/parseExpressionString.js'
import { generateTemplateExpression } from '../packages/compiler/src/codegen/generateTemplateExpression.js'

const cases = [
  'not items has x',
  'not user exists',
  '!items has x',
  'a is not b',
  'a and not b is c',
]

for (const mode of ['tight', 'loose']) {
  console.log(`\n--- not: ${mode} ---`)
  for (const src of cases) {
    const ast = parseExpressionString(src, { not: mode })
    console.log(src.padEnd(20), '->', generateTemplateExpression(ast))
  }
}