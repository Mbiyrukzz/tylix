# @tylix/svelte

Svelte 5 for Tylix apps: stores for the session, API data and live
channels, a small history router, server-side rendering, and the Vite
adapter the Tylix CLI loads. Create an app with it:

```sh
npm create tylix@latest my-app -- --frontend svelte
```

## Stores

Call these at the top of a component's `<script>`:

```svelte
<script>
  import { useSession, useApi, useChannel, useHydrated, auth } from '@tylix/svelte'

  const session = useSession()          // $session.user, $session.status
  const posts = useApi('/api/posts')    // $posts.data, $posts.loading; posts.reload()
  const chat = useChannel('chat', (message) => console.log(message))
  const status = chat.status            // $status: connecting, open ...
  const hydrated = useHydrated()
</script>
```

On the server, `useSession`, `useRoute` and `useApi` return that request's
own state, so concurrent renders never mix sessions.

## Router

```js
import { route, navigate, matchPath, useRoute } from '@tylix/svelte'

navigate('/dashboard')
matchPath('/posts/:id', '/posts/7') // { id: '7' }
```

## The starter's layout

```
app/frontend/
  App.svelte       every page and its URL (make:page adds routes here)
  providers/       stores with data and actions (usePublicPosts, useMyPosts),
                   shared with child components through context
  services/        the API URLs and calls; only providers use them
  pages/           render only
```

## License

MIT
