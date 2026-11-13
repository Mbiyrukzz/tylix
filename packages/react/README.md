# @tylix/react

React for Tylix apps: hooks for the session, API data and live channels,
route guards, server-side rendering, and the Vite adapter the Tylix CLI
loads. Create an app with it:

```sh
npm create tylix@latest my-app -- --frontend react
```

## Hooks

```jsx
import { useAuth, useApi, useChannel, useHydrated } from '@tylix/react'

function Dashboard() {
  const { user, logout } = useAuth()
  const posts = useApi('/api/posts') // { data, loading, error, status, reload }
  const { send, status } = useChannel('chat', (message) => console.log(message))
  const hydrated = useHydrated() // false until React takes over a server-rendered page
  // ...
}
```

With SSR, `useApi` GET requests are loaded on the server and the page
arrives with their data; the browser reuses it instead of fetching again.

## Route guards

```jsx
import { RequireAuth, GuestOnly } from '@tylix/react'

<Route path="dashboard" element={<RequireAuth fallback={<RedirectToLogin />}><Dashboard /></RequireAuth>} />
<Route path="login" element={<GuestOnly fallback={<Navigate to="/dashboard" />}><Login /></GuestOnly>} />
```

Guards decide what to show; the API routes behind `requireAuth` protect
the data.

## The starter's layout

Apps created with `create-tylix` keep data out of pages:

```
app/frontend/
  App.jsx          providers around <AppRoutes />
  AppRoutes.jsx    every page and its URL (make:page adds routes here)
  providers/       context with data and actions (usePublicPosts, useMyPosts)
  services/        the API URLs and calls; only providers use them
  pages/           render only
```

## Server rendering

`@tylix/react/server` exports `renderWithData`, which the starter's
`entry-server.jsx` uses. Turn SSR on with `frontend.ssr: true` in
`tylix.config`.

## License

MIT
