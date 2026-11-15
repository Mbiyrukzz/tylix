import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jobSource, observerSource, traitSource, wireObserver } from './makeBackend.js'

test('wireObserver adds the import and static observers to the model class', () => {
  const model = [
    "import { Model } from '@tylix/orm'",
    "import { hashPassword } from '@tylix/auth'",
    '',
    'export class User extends Model {',
    "  static table = 'users'",
    '}',
    '',
  ].join('\n')
  assert.equal(
    wireObserver(model, 'User', 'UserObserver'),
    [
      "import { Model } from '@tylix/orm'",
      "import { hashPassword } from '@tylix/auth'",
      "import { UserObserver } from '../observers/UserObserver.js'",
      '',
      'export class User extends Model {',
      '  static observers = [UserObserver]',
      "  static table = 'users'",
      '}',
      '',
    ].join('\n'),
  )
})

test('wireObserver works with trait bases and refuses what it cannot edit safely', () => {
  const withTraits = "import { Model, use } from '@tylix/orm'\nexport class Post extends use(Model, Searchable({ fields: ['title'] })) {\n}\n"
  assert.match(wireObserver(withTraits, 'Post', 'PostObserver'), /\{\n  static observers = \[PostObserver\]\n\}/)

  assert.equal(wireObserver("export class User extends Model {\n  static observers = [A]\n}", 'User', 'B'), null, 'already has observers')
  assert.equal(wireObserver('export default class User extends Model {}', 'User', 'B'), null, 'unusual layout')
  assert.equal(wireObserver('export class Other extends Model {\n}', 'User', 'B'), null, 'different class')
})

test('generated sources', () => {
  assert.match(jobSource('SendInvoice', true), /export const SendInvoice: JobHandler = \{/)
  assert.match(jobSource('SendInvoice', true), /tries: 3,\n  backoff: \[10, 60, 300\],/)
  assert.match(jobSource('SendInvoice', true), /async handle\(payload: Record<string, unknown>\)/)
  assert.doesNotMatch(jobSource('SendInvoice', false), /Record</)

  const observer = observerSource('UserObserver', 'User', false)
  assert.match(observer, /export class UserObserver \{/)
  assert.match(observer, /async created\(user\)/)
  // Only created() is active: hooks like updating() cost an extra read.
  assert.doesNotMatch(observer, /^\s+(updating|updated|deleting|deleted|creating)\(/m)

  assert.match(traitSource('Publishable', true), /import type \{ Model \} from '@tylix\/orm'[\s\S]*<T extends typeof Model>\(Base: T\) =>\n  class extends Base/)
  assert.match(traitSource('Publishable', false), /export const Publishable = \(Base\) =>/)
})
