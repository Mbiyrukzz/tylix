import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, validateAsync } from './validate.js'
import {
  required, nullable, isString, isBoolean, isInteger, isNumber, isArray, isEmail, isUrl, isDate,
  minLength, maxLength, min, max, oneOf, matches, confirmed, unique, withMessage,
} from './rules.js'

test('passes, and data holds only the declared fields', () => {
  const result = validate(
    { title: 'Hello', published: true, role: 'admin' },
    { title: [required, isString], published: [isBoolean] },
  )
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, {})
  assert.deepEqual(result.data, { title: 'Hello', published: true })
})

test('one message per field: the first rule that fails', () => {
  const result = validate({ password: '' }, { password: [required, isString, minLength(8)] })
  assert.deepEqual(result.errors, { password: ['This field is required.'] })
  assert.deepEqual(validate({ password: 'short' }, { password: [required, minLength(8)] }).errors, {
    password: ['This field must be at least 8 characters.'],
  })
})

test('missing input does not crash', () => {
  assert.deepEqual(validate(undefined, { title: [required] }).errors, { title: ['This field is required.'] })
  assert.equal(validate(null, { title: [isString] }).valid, true)
})

test('optional fields skip their rules when absent or empty; nullable keeps null', () => {
  assert.equal(validate({ website: '' }, { website: [isUrl] }).valid, true)
  assert.deepEqual(validate({}, { nickname: [isString] }).data, {})
  const result = validate({ bio: null }, { bio: [nullable, isString, minLength(3)] })
  assert.equal(result.valid, true)
  assert.deepEqual(result.data, { bio: null })
  // required + nullable: the field must be sent, but may be null.
  assert.equal(validate({ bio: null }, { bio: [required, nullable, isString] }).valid, true)
  assert.equal(validate({}, { bio: [required, nullable, isString] }).valid, false)
})

test('numbers: isNumber accepts decimals, isInteger does not', () => {
  assert.equal(validate({ total: 9.99 }, { total: [isNumber] }).valid, true)
  assert.equal(validate({ total: '9.99' }, { total: [isNumber] }).valid, false)
  assert.equal(validate({ total: Number.NaN }, { total: [isNumber] }).valid, false)
  assert.equal(validate({ count: 1.5 }, { count: [isInteger] }).valid, false)
  assert.deepEqual(validate({ age: 12 }, { age: [isInteger, min(18)] }).errors, { age: ['This field must be at least 18.'] })
  assert.equal(validate({ age: 200 }, { age: [max(150)] }).valid, false)
})

test('strings and lists', () => {
  assert.equal(validate({ email: 'a@b.co' }, { email: [isEmail] }).valid, true)
  assert.equal(validate({ email: 'nope' }, { email: [isEmail] }).valid, false)
  assert.equal(validate({ email: 42 }, { email: [isEmail] }).valid, false)
  assert.equal(validate({ url: 'https://tylix.dev/x' }, { url: [isUrl] }).valid, true)
  assert.equal(validate({ url: 'javascript:alert(1)' }, { url: [isUrl] }).valid, false)
  assert.equal(validate({ day: '2026-11-13' }, { day: [isDate] }).valid, true)
  assert.equal(validate({ day: '2026-02-30T10:00:00Z' }, { day: [isDate] }).valid, true, 'Date.parse rolls over; accepted')
  assert.equal(validate({ day: 'tomorrow' }, { day: [isDate] }).valid, false)
  assert.equal(validate({ tags: ['a'] }, { tags: [isArray, maxLength(1)] }).valid, true)
  assert.deepEqual(validate({ tags: ['a', 'b'] }, { tags: [maxLength(1)] }).errors, { tags: ['Choose at most 1.'] })
  assert.deepEqual(validate({ tags: [] }, { tags: [required] }).errors, { tags: ['This field is required.'] })
  assert.equal(validate({ status: 'draft' }, { status: [oneOf(['draft', 'published'])] }).valid, true)
  assert.match(validate({ status: 'x' }, { status: [oneOf(['draft', 'published'])] }).errors.status[0], /draft, published/)
  const slug = matches(/^[a-z-]+$/g, 'Lowercase letters and dashes only.')
  assert.equal(validate({ slug: 'a-b' }, { slug: [slug] }).valid, true)
  assert.equal(validate({ slug: 'a-b' }, { slug: [slug] }).valid, true, '/g pattern is reset each time')
  assert.deepEqual(validate({ slug: 'A B' }, { slug: [slug] }).errors, { slug: ['Lowercase letters and dashes only.'] })
})

test('confirmed() compares with <field>_confirmation or a named field', () => {
  const schema = { password: [required, confirmed()] }
  assert.equal(validate({ password: 'x', password_confirmation: 'x' }, schema).valid, true)
  assert.deepEqual(validate({ password: 'x', password_confirmation: 'y' }, schema).errors, {
    password: ['The confirmation does not match.'],
  })
  assert.equal(validate({ a: 1, b: 1 }, { a: [confirmed('b')] }).valid, true)
})

test('custom messages: factory argument and withMessage', () => {
  const result = validate({}, { name: [withMessage(required, 'Tell us your name.')], age: [required] })
  assert.deepEqual(result.errors.name, ['Tell us your name.'])
  assert.deepEqual(validate({ p: 'a' }, { p: [minLength(3, 'Too short.')] }).errors, { p: ['Too short.'] })
  // withMessage keeps required-ness, so an empty optional field still fails.
  assert.equal(validate({ name: '' }, { name: [withMessage(required, 'x')] }).valid, false)
})

test('nested fields by dot path', () => {
  const result = validate(
    { address: { city: 'Kigali', zip: 5 }, extra: 1 },
    { 'address.city': [required, isString], 'address.zip': [isString] },
  )
  assert.deepEqual(result.errors, { 'address.zip': ['This field must be a string.'] })
  assert.deepEqual(validate({ address: { city: 'Kigali' } }, { 'address.city': [required] }).data, { address: { city: 'Kigali' } })
  assert.deepEqual(validate({ address: 'x' }, { 'address.city': [required] }).errors, { 'address.city': ['This field is required.'] })
})

test('plain one-argument rules written before contexts still work', () => {
  const even = (value) => (value % 2 === 0 ? null : 'Must be even.')
  assert.deepEqual(validate({ n: 3 }, { n: [required, even] }).errors, { n: ['Must be even.'] })
})

test('schema mistakes are reported clearly', () => {
  assert.throws(() => validate({}, { p: [minLength] }), /minLength for "p" needs calling/)
  assert.throws(() => validate({}, { p: isString }), /list of rule functions/)
  assert.throws(() => validate({}, null), /needs a schema/)
  assert.throws(() => matches('abc'), /regular expression/)
})

// A stand-in for a model: where(column, value)[.where('id', '!=', id)].first()
function fakeModel(rows) {
  const query = (filters) => ({
    where: (column, op, value) => query([...filters, [column, op, value]]),
    first: async () =>
      rows.find((row) => filters.every(([c, op, v]) => (op === '!=' ? row[c] !== v : row[c] === op))) ?? null,
  })
  return { where: (column, value) => query([[column, value]]) }
}

test('unique() needs validateAsync and honours ignore', async () => {
  const User = fakeModel([{ id: 1, email: 'taken@example.com' }])
  const schema = { email: [required, isEmail, unique(User)] }
  assert.throws(() => validate({ email: 'taken@example.com' }, schema), /use validateAsync/)
  assert.deepEqual((await validateAsync({ email: 'taken@example.com' }, schema)).errors, {
    email: ['This value is already taken.'],
  })
  assert.equal((await validateAsync({ email: 'new@example.com' }, schema)).valid, true)
  const onUpdate = { email: [unique(User, 'email', { ignore: (data) => data.id })] }
  assert.equal((await validateAsync({ id: 1, email: 'taken@example.com' }, onUpdate)).valid, true)
  assert.deepEqual((await validateAsync({ email: 'bad' }, schema)).errors, { email: ['This field must be a valid email address.'] })
  assert.throws(() => unique({}), /needs a model class/)
})

test('validateAsync gives the same result as validate for sync schemas', async () => {
  const schema = { title: [required, isString, maxLength(5)], n: [isNumber] }
  const input = { title: 'too long', n: 2, x: 1 }
  assert.deepEqual(await validateAsync(input, schema), validate(input, schema))
})
