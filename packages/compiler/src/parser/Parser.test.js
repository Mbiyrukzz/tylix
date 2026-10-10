import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Lexer } from '../lexer/Lexer.js'
import { Parser } from './Parser.js'

function parse(source) {
  const tokens = new Lexer(source).tokenize()
  return new Parser(tokens).parse()
}

// AST nodes carry extra bookkeeping fields (line, typeAnnotation,
// computed, optional) that most of these tests don't care about.
// pickShape keeps only the keys named in `shape`, so a test asserts
// on what it means to check and doesn't break when a node gains a
// field.
function pickShape(actual, shape) {
  if (Array.isArray(shape)) {
    return Array.isArray(actual)
      ? actual.map((item, i) => pickShape(item, shape[i]))
      : actual
  }
  if (shape && typeof shape === 'object') {
    const out = {}
    for (const key of Object.keys(shape)) {
      out[key] = pickShape(actual?.[key], shape[key])
    }
    return out
  }
  return actual
}

function assertMatches(actual, shape) {
  assert.deepEqual(pickShape(actual, shape), shape)
}

// The same content written braced or bare lands on different lines,
// so line numbers are dropped before comparing the two ASTs.
function withoutLines(node) {
  return JSON.parse(
    JSON.stringify(node, (key, value) => (key === 'line' ? undefined : value)),
  )
}

test('respects operator precedence: multiplication before addition', () => {
  const source = `action\n  compute() {\n    return 1 + 2 * 3\n  }`
  const ast = new Parser(new Lexer(source).tokenize()).parse()
  const method = ast.actions[0]
  // 1 + (2 * 3), not (1 + 2) * 3
  assert.equal(method.body[0].argument.type, 'BinaryExpression')
  assert.equal(method.body[0].argument.operator, '+')
  assert.equal(method.body[0].argument.right.operator, '*')
})

// Phase 5
test('desugars += into target = target + value', () => {
  const ast = new Parser(
    new Lexer('action\n  inc() {\n    this.count += 1\n  }').tokenize(),
  ).parse()
  const stmt = ast.actions[0].body[0]
  assert.equal(stmt.expression.type, 'AssignmentExpression')
  assert.equal(stmt.expression.value.type, 'BinaryExpression')
  assert.equal(stmt.expression.value.operator, '+')
})

// Phase 6
test('parses a single-param arrow function used as a call argument', () => {
  const ast = new Parser(
    new Lexer(
      'computed\n  activeItems() {\n    return this.items.filter(item => item.active)\n  }',
    ).tokenize(),
  ).parse()
  const returnArg = ast.computed[0].body[0].argument
  const arrowArg = returnArg.args[0]
  assert.equal(arrowArg.type, 'ArrowFunctionExpression')
  assert.deepEqual(arrowArg.params, ['item'])
})

// Phase 4
test('parses a template literal with a single interpolation', () => {
  const ast = new Parser(
    new Lexer(
      'action\n  greet() {\n    this.message = `Hello ${this.name}`\n  }',
    ).tokenize(),
  ).parse()
  const value = ast.actions[0].body[0].expression.value
  assert.equal(value.type, 'TemplateLiteralExpression')
  assert.equal(value.parts[0].value, 'Hello ')
  assert.equal(value.parts[1].expression.type, 'MemberExpression')
})

test('parses a props block', () => {
  const ast = parse(`props { title: String }`)
  assertMatches(ast.props, [
    { type: 'Prop', name: 'title', propType: 'String' },
  ])
})

test('parses a bare props block with a prop named title', () => {
  const ast = parse(`props\ntitle: String`)
  assertMatches(ast.props, [
    { type: 'Prop', name: 'title', propType: 'String' },
  ])
})

test('accepts other keyword tokens as prop names', () => {
  const ast = parse(`props { title: String, layout: String }`)
  assert.equal(ast.props.length, 2)
  assert.equal(ast.props[0].name, 'title')
  assert.equal(ast.props[1].name, 'layout')
})

test('a page-level title section still parses after a bare props block', () => {
  const ast = parse(`props\nname: String\ntitle "Home"`)
  assert.equal(ast.props.length, 1)
  assert.equal(ast.title, 'Home')
})

test('parses a state block with number and string values', () => {
  const ast = parse(`state { count: 0, label: "hi" }`)
  assertMatches(ast.state, [
    { type: 'State', name: 'count', value: { type: 'Literal', value: 0 } },
    { type: 'State', name: 'label', value: { type: 'Literal', value: 'hi' } },
  ])
})

test('parses a computed block with return + member/binary expressions', () => {
  const ast = parse(`
    computed {
      doubled() {
        return this.count * 2
      }
    }
  `)
  const method = ast.computed[0]
  assert.equal(method.name, 'doubled')
  assert.deepEqual(method.params, [])
  assert.equal(method.body[0].type, 'ReturnStatement')
  assertMatches(method.body[0].argument, {
    type: 'BinaryExpression',
    operator: '*',
    left: {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'this' },
      property: 'count',
    },
    right: { type: 'Literal', value: 2 },
  })
})

test('parses an action block with an assignment statement', () => {
  const ast = parse(`
    action {
      increment() {
        count = count + 1;
      }
    }
  `)
  const method = ast.actions[0]
  assert.equal(method.name, 'increment')
  assert.deepEqual(method.body[0].expression, {
    type: 'AssignmentExpression',
    target: { type: 'Identifier', name: 'count' },
    value: {
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Identifier', name: 'count' },
      right: { type: 'Literal', value: 1 },
    },
  })
})

test('parses a method with parameters', () => {
  const ast = parse(`
    action {
      setCount(newValue) {
        count = newValue;
      }
    }
  `)
  // Params carry an optional type annotation, so they are objects.
  assert.deepEqual(ast.actions[0].params, [
    { name: 'newValue', typeAnnotation: null },
  ])
})

test('accepts a keyword token as a method parameter name', () => {
  const ast = parse(`
    action {
      setTitle(title) {
        this.title = title
      }
    }
  `)
  assert.deepEqual(ast.actions[0].params, [
    { name: 'title', typeAnnotation: null },
  ])
})

test('accepts a keyword token as a destructured property and binding name', () => {
  assert.doesNotThrow(() =>
    parse(`
      action {
        load() {
          const { title } = this.data
          const layout = title
        }
      }
    `),
  )
})

test('accepts a keyword token as a key in an object type annotation', () => {
  assert.doesNotThrow(() => parse(`state { post({ title: string }): null }`))
})

test('parses a full realistic page script', () => {
  const ast = parse(`
    props { title: String }
    state { count: 0 }
    computed {
      doubled() { return count * 2 }
    }
    action {
      increment() { count = count + 1; }
    }
  `)
  assert.equal(ast.props.length, 1)
  assert.equal(ast.state.length, 1)
  assert.equal(ast.computed.length, 1)
  assert.equal(ast.actions.length, 1)
})

test('throws a clear error when a state entry is missing its colon', () => {
  assert.throws(() => parse(`state { count 0 }`), /Expected ':'/)
})

test('throws a clear error on an unknown top-level keyword', () => {
  assert.throws(() => parse(`bogus { }`), /Unexpected token/)
})

test('parses a bare (unbraced) state block', () => {
  const source = `state\ncount: 0\nname: "Ada"`
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  assert.equal(page.state.length, 2)
  assert.equal(page.state[0].name, 'count')
  assert.equal(page.state[1].name, 'name')
})

test('parses bare action and computed sections back to back', () => {
  const source = `
computed
doubled() {
  return this.count * 2
}
action
increment() {
  this.count = this.count + 1
}
`
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  assert.equal(page.computed.length, 1)
  assert.equal(page.computed[0].name, 'doubled')
  assert.equal(page.actions.length, 1)
  assert.equal(page.actions[0].name, 'increment')
})

test('bare state block correctly stops at the next section keyword', () => {
  const source = `state\ncount: 0\naction\nincrement() { this.count = this.count + 1 }`
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  assert.equal(page.state.length, 1)
  assert.equal(page.actions.length, 1)
})

test('braced and bare syntax produce identical ASTs for the same content', () => {
  const braced = `state { count: 0 }`
  const bare = `state\ncount: 0`

  const bracedPage = new Parser(new Lexer(braced).tokenize()).parse()
  const barePage = new Parser(new Lexer(bare).tokenize()).parse()

  // Same content, different line numbers (1 vs 2), so compare
  // everything except `line`.
  assert.deepEqual(withoutLines(bracedPage.state), withoutLines(barePage.state))
})

test('parses a method call with no arguments inside an action body', () => {
  const source = `action\nload() {\n  this.fetch()\n}`
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  const stmt = page.actions[0].body[0]
  assert.equal(stmt.expression.type, 'CallExpression')
})

test('parses a call with arguments', () => {
  const source = `action\nremove(id) {\n  this.deleteItem(id)\n}`
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  const call = page.actions[0].body[0].expression
  assert.equal(call.type, 'CallExpression')
  assert.equal(call.args.length, 1)
  assert.equal(call.args[0].name, 'id')
})

test('parses chained member access followed by a call', () => {
  const source = `action\ndoIt() {\n  this.api.remove(1)\n}`
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  const call = page.actions[0].body[0].expression
  assert.equal(call.type, 'CallExpression')
  assert.equal(call.callee.type, 'MemberExpression')
  assert.equal(call.callee.property, 'remove')
})