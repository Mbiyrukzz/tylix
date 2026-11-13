import { test } from 'node:test'
import assert from 'node:assert/strict'
import { words, pascalCase, camelCase, snakeCase, kebabCase, titleCase } from './case.js'
import { pluralize, singularize } from './pluralize.js'

test('case conversions agree on one name', () => {
  for (const input of ['UserProfile', 'userProfile', 'user-profile', 'user_profile', 'user profile']) {
    assert.equal(pascalCase(input), 'UserProfile', input)
    assert.equal(camelCase(input), 'userProfile', input)
    assert.equal(snakeCase(input), 'user_profile', input)
    assert.equal(kebabCase(input), 'user-profile', input)
  }
  assert.equal(titleCase('userProfile'), 'User Profile')
})

test('acronyms and SCREAMING_CASE', () => {
  assert.deepEqual(words('XMLHttpRequest2'), ['XML', 'Http', 'Request2'])
  assert.equal(pascalCase('APIKey'), 'APIKey')
  assert.equal(camelCase('APIKey'), 'apiKey')
  assert.equal(kebabCase('APIKey'), 'api-key')
  assert.equal(pascalCase('USER_ID'), 'UserId')
  assert.equal(snakeCase('USER_ID'), 'user_id')
  assert.equal(pascalCase('post'), 'Post')
  assert.equal(pascalCase(''), '')
})

test('pluralize: rules, exceptions, capitals, compound names', () => {
  const cases = {
    customer: 'customers', category: 'categories', box: 'boxes', status: 'statuses', class: 'classes',
    analysis: 'analyses', users: 'users', person: 'people', Person: 'People', quiz: 'quizzes', leaf: 'leaves',
    news: 'news', series: 'series', day: 'days', BlogPost: 'BlogPosts', user_category: 'user_categories',
    OrderItem: 'OrderItems', people: 'people',
  }
  for (const [one, many] of Object.entries(cases)) assert.equal(pluralize(one), many, one)
})

test('singularize is the reverse', () => {
  const cases = {
    customers: 'customer', categories: 'category', boxes: 'box', statuses: 'status', classes: 'class',
    analyses: 'analysis', people: 'person', People: 'Person', quizzes: 'quiz', leaves: 'leaf', news: 'news',
    status: 'status', BlogPosts: 'BlogPost', user_categories: 'user_category', days: 'day', user: 'user',
  }
  for (const [many, one] of Object.entries(cases)) assert.equal(singularize(many), one, many)
})
