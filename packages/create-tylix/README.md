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
- **Authentication**: login, registration, email verification and password reset
- **Styling**, plus the Starter App (landing page, posts, dashboard) in every project

Before anything is written it shows the choices and waits on
**Create project** (Enter) or **Cancel**.

Non-interactive (`--database` takes `sqlite`, `postgres`, `mysql`,
`mariadb`, `cockroach`, `mongodb` or `none`):

```sh
npx create-tylix@latest my-app --yes --frontend react --language ts --database sqlite --auth yes
```

Every app gets the same backend layout (`app/controllers`, `models`,
`routes`, `jobs`, `observers`, `traits`, ...), tests, `tylix-icons`, and a
`.env` documenting every setting. Hosted frontends keep data in
`providers/` and API calls in `services/`, so pages only render.

Use `@latest`: a cached older version would create an app from older
templates.

## License

MIT
