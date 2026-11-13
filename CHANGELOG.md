# Changelog

All Tylix packages share one version number and are released together.

## 1.1.0

- **Hot reload**: saving `app/loading.tyx`, `app/index.html`,
  `app/tailwind-input.css` or any `.tyx`/`.css` file outside `app/pages`
  now reloads the page; a new or deleted page is routed without a manual
  restart; Tailwind and PostCSS config changes restart the server.
- **Hot reload, hosted frontends**: after a backend change restarts the
  server, open tabs now reload (the Vite HMR port stays the same across
  restarts). Angular pages edited under SSR render the new template on the
  server too, not only in the browser.
- **Error pages**: browsers get a themed page for a production 500 (with the
  request id to quote), a 400 and a 404 instead of JSON; API clients still
  get JSON. A production `.tyx` page that fails to render shows the same
  page. In development, a failed server render opens Vite's error overlay
  over the page, and a frontend that can't load shows the full debug page.
- **Frontends**: `ErrorBoundary` in `@tylix/react` and `@tylix/vue`, and
  `provideAppErrorHandler()` / `injectAppError()` in `@tylix/angular`. The
  starters use them (Svelte uses `<svelte:boundary>`) to show an error page
  when a page throws, with the error in development only; a server-rendered
  error page answers with status 500.
- **Angular**: peer dependencies are now `>=20.0.0 <23.0.0` instead of
  open-ended.
- **Testing**: `npm run test:e2e:frontends` (all starters, dev and
  production), `npm run test:compat` (framework majors), `npm run verify`,
  and a CI workflow running all three. The parity check also sends
  concurrent server renders for different visitors and checks each gets its
  own page.

## 1.0.0

The first stable release. From here on, Tylix follows semantic versioning:
1.x releases won't break apps built on 1.0; breaking changes wait for 2.0.

No changes from 0.7.0 beyond the version.

## 0.7.0

- **Frontends**: React, Vue, Svelte and Angular starters keep data in
  `providers/` and API calls in `services/`; pages only render. React
  routes live in `AppRoutes`.
- **Icons**: `tylix-icons` grows to 537 icons, for native Tylix, React,
  Vue, Svelte and Angular.
- **Validation**: many new rules, nested fields, typed results, and
  `@tylix/shared/validation`, which runs in the browser too.
- **Settings**: `app`, `server`, `store`, `channels` and `observability`
  sections checked on startup; layered `.env` files; `tylix doctor` shows
  where each value comes from.
- **Observability**: request ids, JSON logs, slow-request and slow-query
  warnings, `/health`, `/ready` and `/metrics`.
- **Scaling**: `tylix start --workers`, a shared store (database or
  Redis) for the cache, rate limits and channel messages, `broadcast()`
  from app code, and atomic job claiming.
- **Performance**: a segment-tree router, cached SQLite statements, JSON
  compression, and cheaper responses.
- **Fixes**: `@tylix/mail` declares its `@tylix/generator` dependency; a
  running server now sees columns added by migrations from other
  processes.
- Every package now ships with the MIT license, a README and `engines`
  (Node 22.13 or later).
