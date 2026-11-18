# create-tylix

Creates a new Tylix app.

```sh
npm create tylix@latest
# or
npx create-tylix@latest my-app
```

The installer asks for:

- **Frontend**: native Tylix (`.tyx` pages), React, Vue, Svelte or Angular
- **Language**: JavaScript or TypeScript (Angular is TypeScript)
- **Database**: SQLite, PostgreSQL, MySQL, MariaDB, CockroachDB or MongoDB
- **Styling**: Tailwind CSS or plain CSS
- **PWA**: whether to make it an installable, offline-ready app

Every project is the full Starter App (landing page, posts, dashboard) with
authentication built in: login, registration, Google/GitHub sign-in, email
verification and password reset.

Before anything is written it shows the choices and waits on
**Create project** (Enter) or **Cancel**.

Non-interactive (`--database` takes `sqlite`, `postgres`, `mysql`,
`mariadb`, `cockroach` or `mongodb`; add `--pwa` for an installable app):

```sh
npx create-tylix@latest my-app --yes --frontend react --language ts --database sqlite --pwa
```

Every app gets the same backend layout (`app/controllers`, `models`,
`routes`, `jobs`, `observers`, `traits`, ...), tests, `tylix-icons`, and a
`.env` documenting every setting. Hosted frontends keep data in
`providers/` and API calls in `services/`, so pages only render.

React, Vue, Svelte and Angular starters include a `PageLoading` component
(the Tylix mark, lit stroke by stroke) that every page shows while its data
loads:

```jsx
<PageLoading />                                // a whole page
<PageLoading compact label="Loading posts" />  // one section of a page
```

Image uploads (up to 2 MB) work out of the box: `.env` sets
`MAX_BODY_BYTES=4194304` because base64 makes an upload about a third
bigger than the image.

Use `@latest`: a cached older version would create an app from older
templates.

## License

MIT
