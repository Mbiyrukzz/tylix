# Changelog

All Tylix packages share one version number and are released together.

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
