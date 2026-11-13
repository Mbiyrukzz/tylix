# @tylix/shared

The pieces every Tylix package uses: validation that runs on the server
and in the browser, settings and `.env` loading, and naming helpers.

```sh
npm install @tylix/shared
```

## Validation

```js
import { validate, required, isEmail, minLength, oneOf, withMessage, firstError } from '@tylix/shared/validation'

const result = validate(req.body, {
  email: [withMessage(required, 'Enter your email.'), isEmail],
  password: [required, minLength(8)],
  status: [oneOf(['draft', 'published'])],
})
if (!result.valid) return res.status(422).json({ errors: result.errors })
await Post.create(result.data) // only the declared fields
```

Rules: `required`, `nullable`, `isString`, `isNumber`, `isInteger`,
`isBoolean`, `isEmail`, `isUrl`, `isDate`, `isArray`, `minLength`,
`maxLength`, `min`, `max`, `oneOf`, `matches`, `confirmed`, `unique`
(with `validateAsync`) and `withMessage`. Nested fields use dot paths
(`'address.city'`). In TypeScript, `result.data` is typed from the schema.

`@tylix/shared/validation` has no Node imports, so frontends import the
same rules; the starters' login and register forms use the app's
`AuthValidator`.

## Settings

```js
import { loadConfig } from '@tylix/shared'

const config = await loadConfig(process.cwd(), 'typescript')
config.server.port // PORT, else tylix.config, else 3000
config.sources['server.port'] // { from: '.env', env: 'PORT' }
```

Values come from the defaults, then `tylix.config`, then the environment.
A value that can't be used (`PORT=abc`) stops the app with a message naming
it. `.env` files layer: `.env.<mode>.local`, `.env.local`, `.env.<mode>`,
`.env`; the shell wins over all of them. They support inline comments,
escapes, values over several lines, and `${VAR}` / `${VAR:-default}`.

## Names

`pascalCase`, `camelCase`, `snakeCase`, `kebabCase`, `titleCase`,
`pluralize` and `singularize`, so one name gives the same class, file, URL
and table names everywhere.

## License

MIT
