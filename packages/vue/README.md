# @tylix/vue

Vue for Tylix apps: composables for the session, API data and live
channels, server-side rendering, and the Vite adapter the Tylix CLI loads.
Create an app with it:

```sh
npm create tylix@latest my-app -- --frontend vue
```

## Composables

```vue
<script setup>
import { useAuth, useApi, useChannel, useHydrated } from '@tylix/vue'

const { user, isAuthenticated, logout } = useAuth()
const { data: posts, loading, error, reload } = useApi('/api/posts')
const post = useApi(() => `/api/public/posts/${route.params.id}`) // refetches when the id changes
const { send, status } = useChannel('chat', (message) => console.log(message))
const hydrated = useHydrated()
</script>
```

Every value is a ref. With SSR, `useApi` GET requests are loaded on the
server and reused in the browser. Router guards can `await sessionReady()`
before deciding.

## The starter's layout

```
app/frontend/
  router.js        every page and its URL (make:page adds routes here)
  providers/       composables with data and actions (usePublicPosts, useMyPosts),
                   shared with child components through provide/inject
  services/        the API URLs and calls; only providers use them
  pages/           render only
```

## Server rendering

`@tylix/vue/server` renders pages for the starter's `entry-server.js`.
Turn SSR on with `frontend.ssr: true` in `tylix.config`.

## License

MIT
