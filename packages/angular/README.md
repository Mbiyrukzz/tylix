# @tylix/angular

Angular (20 and later) for Tylix apps: signals for the session, API data
and live channels, functional route guards, an HttpClient interceptor,
server-side rendering, and the Vite adapter the Tylix CLI loads. Create an
app with it:

```sh
npm create tylix@latest my-app -- --frontend angular
```

## Signals

Call these in an injection context (a field initializer):

```ts
import { injectAuth, injectApi, injectChannel, injectHydrated } from '@tylix/angular'

export class Dashboard {
  protected readonly auth = injectAuth()                  // auth.user(), auth.isAuthenticated()
  protected readonly posts = injectApi<Post[]>('/api/posts') // posts.data(), posts.loading(), posts.reload()
  protected readonly chat = injectChannel<Message>('chat', (message) => console.log(message))
  protected readonly hydrated = injectHydrated()
}
```

With SSR, `injectApi` GET requests are loaded on the server and reused in
the browser.

## Guards and HttpClient

```ts
import { authGuard, guestGuard, tylixInterceptor } from '@tylix/angular'

{ path: 'dashboard', component: Dashboard, canActivate: [authGuard] }
{ path: 'login', component: Login, canActivate: [guestGuard] }

provideHttpClient(withFetch(), withInterceptors([tylixInterceptor]))
```

The interceptor sends the session cookies and, after a 401, renews the
session once and retries.

## The starter's layout

```
app/frontend/
  app.routes.ts    every page and its URL (make:page adds routes here)
  providers/       injectable stores with data and actions (PublicPostsStore,
                   MyPostsStore), provided per page component
  services/        the API URLs and calls; only stores use them
  pages/           render only
```

## License

MIT
