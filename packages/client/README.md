# @tylix/client

The browser side of a Tylix app, with no framework dependency: API
requests, the logged-in session, and live channels. `@tylix/react`,
`@tylix/vue`, `@tylix/svelte` and `@tylix/angular` are built on it, so
every frontend behaves the same.

```sh
npm install @tylix/client
```

## API requests

```js
import { api } from '@tylix/client'

const posts = await api('/api/posts')
if (posts.ok) console.log(posts.data)

const saved = await api.post('/api/posts', { title: 'Hello' })
if (!saved.ok) console.log(saved.status, saved.error, saved.errors)
```

Every call resolves to `{ ok, status, data, error, errors }` and never
throws for HTTP errors. Session cookies are sent automatically. When the
access token has expired, the client renews the session once (shared by
all requests in flight) and retries.

## Typed routes

`tylix routes:types` (and `tylix dev`) writes `api.generated.ts` from the
app's routes. It runs on `createRouteClient`:

```ts
import { routes } from './api.generated'

const post = await routes.posts.show({ id: 7 })       // ApiResult<{ data: Post }>
await routes.posts.update({ id: 7 }, { title: 'New' })
await routes.$request('DELETE /api/posts/:id', { params: { id: 7 } })
```

`buildPath('/api/posts/:id', { id: 7 }, { page: 2 })` gives
`/api/posts/7?page=2`, and throws when a parameter is missing.

## The session

```js
import { auth } from '@tylix/client'

await auth.init()
auth.subscribe((state) => console.log(state.status, state.user))

await auth.login(email, password)
await auth.register({ name, email, password })
await auth.logout()
await auth.forgotPassword(email)
await auth.resetPassword({ email, token, password })
```

`state.status` is `loading`, `authenticated` or `guest`. Logging in or out
in one tab updates every other tab.

## Channels

Live messages from `tylix channels:work`:

```js
import { channel } from '@tylix/client'

const chat = channel('chat')
chat.onMessage((message) => console.log(message))
chat.send({ text: 'hi' })
chat.close()
```

The channel reconnects on its own and queues messages sent while it is
connecting. During server rendering it does nothing.

## License

MIT
