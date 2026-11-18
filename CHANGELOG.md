# Changelog

All Tylix packages share one version number and are released together.

## 2.1.1

### create-tylix: a loading indicator on every page
- React, Vue, Svelte and Angular starters get a `PageLoading` component
  (`components/PageLoading.jsx`, `.vue`, `.svelte`, `components/page-loading.ts`):
  the Tylix mark lit stroke by stroke, in light and dark. It fades in after
  150ms, so quick loads never flash it.
- Every page that waits on data (posts, a post, the dashboard's posts, the
  dev mail log) shows it instead of a line of "Loading…" text, and so does
  the session check before a guarded page. `label` adds a caption and
  `compact` sizes it for one section of a page.
- `tylix-ui.css` adds `.tx-loader-label` and `.tx-loader-sm` for your own
  loaders.

### create-tylix: image uploads work out of the box
- New projects set `MAX_BODY_BYTES=4194304` (4 MB) in `.env`. Images up to
  2 MB are sent to `POST /api/uploads` as base64, about a third bigger, so
  the framework's 1 MB default refused most photos.
- The starters' upload forms say what to change when the server answers 413.
  Existing apps: raise `MAX_BODY_BYTES` in `.env` to at least 3 MB.

### Logos
- New `@tylix/excel` and `@tylix/pdf` logos.

### Fixes
- `tylix tinker`: `routes()` and `pages()` keep the folder of nested pages.
  `docs/[slug].tyx` is listed as `/docs/:slug` (it was `/:slug`), and files in
  `app/pages/components` are no longer shown as page routes.
- `tylix tinker`: `models()` works at the prompt. It threw `ERR_INVALID_THIS`
  reading Node's `crypto` global.
- `tylix tinker --eval`: `models()`, `reload()` and `mail()` work (they threw
  `Cannot access 'replServer' before initialization`), and the mailer
  functions `mail()` loads can be called on the following lines.

## 2.1.0

### Roles and permissions: `@tylix/permissions`
- A new package for any JavaScript app, inspired by spatie/laravel-permission:
  roles, permissions and direct grants, plus built-in wildcards
  (`posts.*`, `posts.edit,delete`, `*`), role inheritance, explicit denies
  (`!posts.delete`, `deny()`) that beat any allow, teams on every
  assignment, grants that expire, default roles for every signed-in user,
  resource rules (`can(user, 'posts.update', post)`), a declarative
  `sync()`, and a shared-cache option for several processes.
- Stores: memory, the Tylix ORM (six tables, `createPermissionTables`), or
  your own (eight methods).
- `user.access` snapshots checked synchronously in the browser with the
  server's matching, with helpers for React (`<Can>`, `useCan`), Vue
  (`v-can`, `$can`, `useCan`), Svelte (`abilityStore`, `use:can`) and
  Angular (`injectCan`, `permissionGuard`).
- HTTP guards: `permissions.middleware()` for Tylix, Express and Connect,
  `guard()` around a handler, `guardRequest()` for web `Request` frameworks.
- `tylix make:permissions` writes the instance and starting roles, `Role`
  and `Permission` models, the migration, a seeder, an admin API and, for
  `.tyx` apps, an admin page at `/admin/access` with modals to create
  roles and permissions and give users roles. Changes that would remove
  your own access are refused and rolled back.
- `tylix permission:create-role`, `permission:create-permission`,
  `permission:assign`, `permission:revoke`, `permission:show` (a role ×
  permission matrix) and `permission:sync`.
- With `app/permissions`, `GET /api/me` and the SSR session carry
  `user.access`; `.tyx` templates get `can()`, `cannot()`, `canAny()` and
  `hasRole()`, and a page's `permissions` block is enforced (login for
  guests, a 403 panel for others). `tylix dev` marks guarded routes with 🔑.

### Progressive web apps: `@tylix/pwa`
- `pwa` in `tylix.config` (or `tylix make:pwa`) makes any Tylix app
  installable and usable offline, for `.tyx` pages and React, Vue, Svelte
  and Angular alike: Tylix serves `/manifest.webmanifest` and a generated
  `/sw.js`, and adds the tags to every page.
- The worker precaches `public/` and the built bundle, never caches pages
  by default (they can hold a signed-in user's data), never touches the
  API, and serves an offline page. Each deploy is a new version that open
  pages offer to switch to. In development it removes itself.
- Install and update prompts: a `Pwa` capability and `PwaPrompt` component
  for `.tyx` apps, generated components for React, Vue, Svelte and
  Angular, and `usePwa()` / `injectPwa()` / a Svelte store.
- Usable without Tylix: `manifest()`, `serviceWorker()`, `headTags()`.

### create-tylix: authentication in every app
- The installer no longer asks about authentication: every app is the full
  Starter App with login, registration, Google/GitHub sign-in, email
  verification, password reset, the dashboard and posts.
- It asks instead whether to make an installable app (PWA); `--pwa` does
  the same without the prompt.
- **None** is gone from the database choices (authentication needs one);
  `--database none` is refused with a message saying why. `--auth` still
  parses so existing scripts run, and `--auth no` is ignored with a note.

### Loading screen
- Pages the browser renders (every `.tyx` page, and React, Vue, Svelte or
  Angular pages that aren't server-rendered) show a loading screen until
  they first render: the Tylix mark lit stroke by stroke over a progress
  track, in the app's theme colours, light and dark. It only appears after
  150ms, and `loadingScreen: false` in `tylix.config` turns it off.
- `.tx-loader` in tylix-ui.css: the same mark as an in-page loader, used by
  the starter apps while a guarded page waits for the session (React and
  Svelte's `PageLoading`, and now Vue and Angular's first navigation too).

### Fixes
- Angular: server rendering failed with `NG0201: No provider found for
  PlatformDestroyListeners` in apps installed from npm. `@tylix/angular`
  was loaded by Node with its own copy of `@angular/core`; it is now
  bundled into the server build with Angular itself.
- Native components' `style` sections were dropped; they now reach the page.
- `public/*.html` files are served as HTML (they were downloads).
- `%tylix.head%` inside an HTML comment in `app/index.html` no longer gets
  a second copy of the head.

### Logos
- `@tylix/auth`, `@tylix/excel` and `@tylix/pdf` have logos in their READMEs.

## 2.0.0

Tylix 2 is stable. Apps made with 1.x keep running: see
[Upgrading from 1.x](README.md#upgrading-from-1x) for the few things to
check (the new `app/views` folder name, log files in `storage/logs`, and
the one migration job delays need).

### MariaDB and CockroachDB
- `DATABASE_DRIVER=mariadb` (MySQL protocol, through `mysql2`) and
  `DATABASE_DRIVER=cockroach` (PostgreSQL protocol, through `pg`), in
  `create-tylix` (`--database mariadb|cockroach`), `.env` defaults, error
  pages and banners. On CockroachDB, `SERIAL` ids count 1, 2, 3 and come
  back as numbers, as on PostgreSQL.
- PostgreSQL and CockroachDB read `DATABASE_URL` and `DATABASE_SSL`.
- Every adapter has a `dialect`; SQLite and PostgreSQL have `transaction(fn)`.

### Migrations: indexes, foreign keys, and changes that work
- The schema builder moved to `@tylix/orm` (`createSchema(adapter)`) and
  now has `notNullable()`, `default()`, `useCurrent()`, `index()`,
  `unique()`, `table.index([...])`, foreign keys (`foreignId().constrained()`,
  `foreign().references().on()`, `onDelete`), `change()`, `renameColumn`,
  `dropIndex`, `dropUnique`, `dropForeign`, `renameTable`, `hasTable`,
  `hasColumn`, and the column types `bigIncrements`, `bigInteger`,
  `decimal`, `enum`, `uuid`, `time`, `char`, `binary`. Laravel's names
  (`schema.create`, `schema.table`, `dropIfExists`) work too.
- Unique columns get named unique indexes. Before, adding a unique column
  with `field:add` failed on SQLite ("Cannot add a UNIQUE column").
- SQLite rebuilds the table for `change()` and foreign-key changes,
  keeping its rows and indexes.
- Tested against PostgreSQL 17, CockroachDB 24.3, MySQL 8.4, MariaDB 11.4,
  SQLite and MongoDB (`TYLIX_TEST_DATABASES` runs the server tests).
- `tylix migrate:status`, `migrate:rollback [--step=N]`, `migrate:reset`,
  `migrate:refresh [--seed]` and `migrate:fresh [--seed]`; migrations are
  recorded in batches (older tables are upgraded in place). The commands
  that undo or drop work need `--force` in production.
- SQLite and PostgreSQL run each migration in a transaction.
- `make:migration` reads the name: `create_x_table`,
  `add_y_to_x_table`, `remove_y_from_x_table`, `--table=`, `--create=`.
- Field modifiers for `make:feature`, `field:add` and `make:migration`:
  `unique`, `index`, `required`, `nullable`, `default=<value>`. `belongsTo`
  foreign keys are indexed.

### create-tylix
- The last step says what to do: **Create project** (Enter) or **Cancel**,
  with the keys shown.
- The Blank template is gone: every project is the Starter App.
  `--template blank` still runs and creates the Starter App, with a note.

### Typed API client generated from the routes
- `tylix routes:types` (and `tylix dev`, on start) writes a client from
  the routes the app registers: `app/views/api.generated.ts` for hosted
  frontends, `app/types/api.d.ts` for native pages. Routes are named
  `posts.index`, `posts.show`, `auth.refresh`, `login`. Feature routes are
  typed from their fields and auth routes from their bodies. `--check`
  fails when the client is stale. `typedRoutes: false` turns the dev
  write off.
- `@tylix/client` exports `createRouteClient` and `buildPath`.

### Job retries with backoff
- Jobs take `tries`, `backoff` (seconds, a list, `'exponential'` or a
  function), `maxBackoff`, `timeout` and a `failed()` hook, and `handle`
  gets `{ id, attempt, tries }`. `queue` in `tylix.config` and
  `QUEUE_TRIES` / `QUEUE_BACKOFF` / `QUEUE_TIMEOUT` set the defaults.
- `dispatch(name, payload, { delay })`, plus `PermanentJobError`.
- `tylix queue:failed`, `queue:retry <id|all>`, `queue:flush`.
- New apps get an `available_at` column on `jobs`. Existing apps run
  `tylix make:queue-retries && tylix migrate`; until then retries happen
  without a delay.

### Logging, as in Laravel
- `Log` from `@tylix/core`: the eight RFC 5424 levels, `Log.channel()`,
  `Log.stack()`, `Log.build()`, `Log.withContext()`, `Log.extend()`.
- Channels in `logging` in `tylix.config`: `stack`, `single`, `daily`
  (rotated, `days` kept), `console`, `stderr`, `null`, `custom`, each with
  its own minimum `level`. `LOG_CHANNEL`, `LOG_STACK` (default
  `console,daily`) and `LOG_DAILY_DAYS`.
- File lines are written as `[date] env.LEVEL: message {context} {extra}`,
  with the stack trace of any error. Files go in `storage/logs/`.
- `tylix log:tail [channel] [--level=] [--lines=] [--no-follow]` and
  `tylix log:clear`.
- A channel that fails is reported once and never breaks a request.

### Static site generation
- `tylix export` writes `dist/static`: every page without parameters, the
  pages they link to, `export.paths`, and their assets, `public/`
  and a `404.html`. `export.exclude`, `export.crawl`, `--out`.

### Plugin system
- `plugins` in `tylix.config` (objects, packages, files, `[file, options]`)
  and `app/plugins/*`. Hooks: `config`, `register` (middleware, readiness
  checks), `routes`, `boot` and `close`. Plugins can also add
  `logDrivers`, `commands` (run as `tylix <command>`) and `deployAdapters`.
- `tylix plugins` lists them, and `definePlugin` gives them types.

### Deployment adapters
- `tylix deploy:init <adapter>` writes the files for `docker`, `fly`,
  `render`, `railway` or `pm2` (servers), or for `netlify`, `vercel`,
  `github-pages` or `cloudflare-pages` (static export). Plugins can add
  more.

### `app/frontend` is now `app/views`
- New React, Vue, Svelte and Angular apps keep their source in
  `app/views`. Existing apps need no change: when only `app/frontend`
  exists, every command uses it.

## 1.5.0

### Social sign-in in every starter
- **Continue with Google / GitHub** on the login and register pages of all
  five frontends (Tylix, React, Vue, Svelte, Angular), through a new
  `OAuthButtons` component. Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  and `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` to `.env`; the callback
  URLs to register are written next to them.
- `make:auth` adds `oauthStart`, `oauthCallback` and `oauthProviders` to
  `AuthController`, an `OAuthAccount` model and a `create_oauth_accounts_table`
  migration. The server registers `GET /api/auth/oauth/:provider`,
  `GET /api/auth/oauth/:provider/callback` and `GET /api/auth/providers`.
- Built on `createOAuth` (PKCE, sealed state cookie, same-site return
  paths). Accounts are matched by provider id first, then by email only
  when the provider has verified it. Linking to an unverified local
  account resets its password and ends its sessions, so an account opened
  in someone else's name can't be kept. Failures return to
  `/login?error=<code>` with a fixed message, never URL text.

### New look for the starters and the CLI
- New Tylix logo (`logo-mark.svg`, `favicon.svg`, a real multi-size
  `favicon.ico`) in every navbar, footer and status page.
- A design system, `tylix-ui.css`: colour tokens for light and dark
  (`bg-panel`, `text-muted`, `border-line`, `text-brand`, ...) and
  components (`tx-btn`, `tx-input`, `tx-panel`, `tx-glow`, `tx-alert`,
  `tx-auth`, `tx-console`, ...). It ships with Tailwind and plain-CSS
  projects alike, between Tailwind's base and utilities.
- Every starter page is restyled on it: graphite panels, a glowing frame,
  status lights and a console hero, in light and dark.
- `create-tylix` and `tylix dev` print the new logo in the brand blue
  (true colour, with 256-colour and no-colour fallbacks).
- Branded verification and password-reset emails, and the server's status
  pages use the Tylix palette.

### @tylix/auth: works with any framework, hardened
- **Any framework.** A new `createAuth()` engine is built on Web Crypto and
  Web `Request`/`Response`, so it runs on Node, Bun, Deno, Workers and the
  edge. Adapters: `@tylix/auth/next`, `/nuxt` (h3), `/sveltekit`, `/hono`,
  `/express`, `/fastify`, `/koa` and `/web` (Remix, Astro, SolidStart,
  Bun, Deno). There is also a browser client at `/client`.
- **Sessions.** Access tokens are short-lived JWTs. Refresh tokens rotate
  on every use and are stored as HMACs. Replaying an old refresh token
  ends the session (theft detection), with a grace period for parallel
  tabs. Sessions have idle and absolute timeouts, a device list, single
  and all-device revocation, and "remember me". Signing in always ends
  the browser's previous session (no session fixation).
- **Storage adapters:** SQL (`pg`, `mysql2`, SQLite, with a real
  compare-and-swap), Prisma, any key-value store (Redis, Upstash, KV),
  Tylix models, and memory.
- **Tokens.** HS256 JWTs with the algorithm pinned, per-purpose
  HKDF-derived keys, mandatory expiry, canonical base64url decoding, and
  key rotation through key ids. AES-GCM sealing (`createSealer`) covers
  secrets at rest and in cookies.
- **Security checks.** Fetch-Metadata/Origin CSRF checks (sibling
  subdomains are untrusted by default), `__Host-`/`__Secure-` cookie
  prefixes, and a safe-redirect helper.
- **Passwords.** `needsRehash()`, NFC normalization, a 1 KiB input cap,
  and dummy scrypt work for unknown accounts. `checkPasswordStrength()`
  rejects common and contextual passwords and can check Have I Been
  Pwned (k-anonymity).
- **Limits and 2FA.** `createLoginThrottle()` limits per account+IP, per
  account and per IP, so nobody can lock out a victim. TOTP (RFC 6238)
  comes with replay protection and hashed recovery codes.
- **OAuth** with PKCE, encrypted state cookies and verified-email
  semantics. Presets: GitHub, Google, Discord, GitLab, Microsoft.

### Security fixes (Tylix auth flow)
- Email-verification links were valid login tokens for 24 hours. They had
  the same signature as access tokens, and `requireAuth` ignored the
  `purpose` claim. Purpose tokens and never-expiring tokens are now
  refused.
- Logout never revoked the refresh token. The cookie was scoped to
  `/api/auth/refresh`, so `/api/auth/logout` never received it. It is now
  scoped to `/api/auth`.
- Refresh tokens were not rotated, so a stolen one stayed valid for 30
  days.
- Logout, password resets and the new "sign out everywhere" now end
  access immediately: `requireAuth` checks that the token's session still
  exists. Before, access tokens stayed valid until they expired, which in
  scaffolded apps meant up to 7 days.
- The access-token default is now 15 minutes (capped at an hour) instead
  of 7 days.
- Refresh and reset lookups loaded the whole table on every request. They
  are now indexed lookups.
- Login response time revealed which emails were registered. Unknown
  accounts now do the same scrypt work, and forgot-password no longer
  waits on the database for real accounts.
- The login limiter was per-process and keyed by email only. It is now
  shared across workers and keyed per account+IP, per account and per IP.
- Older reset links stayed valid after a new one was issued, and single
  use could be raced. Issuing a link now retires older ones, and claiming
  one is atomic.
- Legacy password hashes were never upgraded. They are now rehashed at
  login.
- The legacy `verifyToken` accepted extra token segments, non-canonical
  signatures and non-object payloads. It now refuses them.

### Tylix apps
- New routes: `POST /api/auth/change-password` (ends other sessions),
  `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`,
  `POST /api/auth/logout-all` and `POST /api/auth/resend-verification`.
- `make:auth` writes an `AuthSession` model and a `create_auth_sessions_table`
  migration (it no longer writes `RefreshToken`).
- New passwords are checked for strength. `auth.checkBreachedPasswords`
  (or `AUTH_CHECK_BREACHED_PASSWORDS=true`) also checks breaches.
- **Upgrading:** run `tylix make:auth`, then `tylix migrate`. Everyone
  signs in once more. `AUTH_SECRET` must be at least 32 characters in
  production.

## 1.4.0

### @tylix/pdf (new)
- `createPdf(definition)` builds PDFs from plain objects in Node, Deno,
  Bun, edge runtimes and browsers. It has no dependencies and uses the
  platform's CompressionStream.
- **Layout:** text wraps and flows across pages. Headings keep with the
  next block, and widow and orphan control stops single lines being left
  alone at the top or bottom of a page. Boxes (padding, background,
  border, radius), columns, lists (bullets, check marks, numbers,
  letters, roman numerals), rules, spacers, page breaks, landscape
  sections and absolutely placed nodes are supported.
- **Tables:** built from objects with `columns` (`key`, nested paths,
  `value()`), with formats (currency, number, percent, date…) and column
  widths that are fixed, percentages, flexible or sized to content.
  colSpan, zebra rows, grid / horizontal / outer borders, rounded
  frames, footers and totals. Headers repeat on every page, and rows
  taller than a page are split.
- **Graphics:** JPEG (with EXIF rotation) and PNG (alpha, palettes,
  interlacing); SVG with gradients, opacity, text and `<style>` rules;
  `@tylix/charts` drawn as vectors; QR codes (all versions and EC
  levels); barcodes (Code 128, EAN-13, UPC-A, EAN-8, Code 39); a canvas
  painter for custom drawing.
- **Fonts:** the built-in Helvetica, Times and Courier (kerned), plus
  TrueType / OpenType embedding with subsetting, ToUnicode maps and
  fallback fonts for CJK and other scripts.
- **Navigation and pages:** headers and footers with `{page}` /
  `{pages}`, backgrounds and watermarks, bookmarks from headings, a
  clickable table of contents with page numbers, and internal and
  external links.
- **HTML:** `{ html }` converts headings, inline formatting, lists,
  tables, images, blockquotes, `pre` and inline styles.
- **Output:** `toBuffer`, `save`, `send(res)`, `toResponse` (fetch),
  `toBlob`, `download`, `open` and `toDataUrl`.

### @tylix/excel (new)
- **One-liners:** `toXlsx(rows)` and `fromXlsx(file)`. The output has a
  styled, frozen header with filters and columns fitted to the content.
- **Workbooks:** `createWorkbook()` with sheets from `columns` and `rows`.
  Named formats (`currency`, `percent`, `date`…) or Excel format codes;
  totals rows; formulas; rich text; hyperlinks; merges; freeze panes;
  Excel tables; dropdowns and other data validation; conditional
  formatting (rules, expressions, duplicates, top N, data bars, color
  scales); images; print setup; named ranges.
- **Reading:** `readWorkbook()` reads `.xlsx` and `.csv`: typed values,
  dates from number formats, formulas with cached results, merges,
  widths and frozen panes.
- **CSV:** `parseCsv` / `toCsv` follow RFC 4180, detect the delimiter,
  handle byte-order marks and neutralize formula injection by default.
- **Speed:** 100,000 rows × 6 columns write in about 2.5 s and read in
  under 2 s.

### Tylix integration
- `res.download(data, filename, { inline })` sends bytes, strings, or
  any document with `toBuffer()` (PDFs, workbooks), with the content
  type taken from the file name.
- `@tylix/mail` attachments accept PDF documents and workbooks directly:
  `{ filename: 'invoice.pdf', content: invoicePdf(invoice) }`.
- `tylix make:pdf <Name>` and `tylix make:export <Name>` generators.
- `.tyx` pages can import both packages in the browser from
  `/_tylix/pdf/` and `/_tylix/excel/`.

## 1.3.0

### @tylix/mail: usable in any Node app
- `createMailer({ transport, from, views })` works without Tylix.
  `@tylix/orm` is now an optional peer and `@tylix/generator` is no longer
  a dependency. Existing `Mail.send()`, Mailables and the mail log are
  unchanged.
- Transports: SMTP (now with AUTH PLAIN and an opt-in `requireTLS`),
  Resend, SendGrid, Postmark, Mailgun (US/EU), Amazon SES (SigV4 signing,
  no SDK), log and memory. In Tylix apps, `MAIL_DRIVER` picks one, with
  `MAIL_API_KEY`, `MAIL_DOMAIN` and `MAIL_REGION` in the starter `.env`.
- Messages take cc, bcc (envelope only), replyTo, a per-message from,
  display names, attachments (from disk or memory), inline images (cid),
  custom headers and provider tags. Header injection is refused before
  anything is sent.
- Templates escape values by default. They support `{{{ raw }}}`,
  dotted paths, `{{#if}}` / `{{#each}}` and an optional `.txt` text part,
  or you can bring your own renderer.
- `Mail.fake()` / `createFakeTransport()` with `assertSent`,
  `assertNotSent`, `assertNothingSent` and `assertSentCount`, plus
  `preview()` for the full `.eml` text. The package now has a test suite
  (29 tests, including a real SMTP conversation).

### Native .tyx syntax
- `bind:value` (text, number, textarea, select, select multiple),
  `bind:checked`, and `bind:group` for radios and checkbox lists.
- `class:name="{{ cond }}"` (and the `class:name` shorthand) and
  `style:prop="{{ value }}"`. These work alongside a dynamic `class` or
  `style` attribute.
- Event modifiers: `.prevent .stop .self .once .capture .passive`, key
  filters (`.enter .esc .space .tab .up .down .left .right .delete
  .backspace`) and `.ctrl .shift .alt .meta`.
- Component children: `<Card>…</Card>` renders where the component puts
  `<slot />`, with named slots (`slot="footer"`) and fallback content.
  Previously the children were dropped silently.
- `{{#await p}}…{{#then v}}…{{#catch e}}…{{/await}}`, the short form
  `{{#await p then v}}`, and `{{@html trusted}}`.
- **Fixed**: a template variable with the same name as an internal
  temporary (`v`, `frag`, `p`…) rendered nothing, for example
  `{{#each v in list}}{{ v }}{{/each}}`.
- **Fixed**: a function used as an operand lost its parentheses, so
  `a ?? (v => v)` compiled to invalid JavaScript.
- The VS Code grammar, snippets and language server know the new syntax.

### @tylix/charts
- New charts: scatter / bubble, gauge, and calendar heatmap, each with a
  `.tyx` component (`<ScatterChart>`, `<Gauge>`, `<Heatmap>`).
- Time axes: `Date` x values tick on calendar boundaries with matching
  labels and tooltip dates (`timeZone`, `locale`).
- Accessibility: `<title>` and a plain-language `<desc>` in every SVG,
  `dataTable()` and `describeSeries()`, a hidden data table in the
  components, and `role="meter"` on the gauge.
- React (`@tylix/charts/react`), Vue (`/vue`) and Svelte 5 (`/svelte`)
  wrappers with SSR-safe ids and the interactive crosshair, plus
  `renderChart(type, data, options)` for anything else.
- README rewritten to cover every chart.

## 1.2.0

- **VS Code extension** ships as `tylix.tyx-language` 1.2.0, the next
  version of the earlier grammar-only extension. It keeps the Tylix
  Dark/Light color themes (ported to the new grammar) and adds the Tylix
  logo as its icon, a `.tyx` file icon that works in any icon theme, and
  a **Tylix Icons** theme with Tylix folder icons (`pages`, `components`,
  `capabilities`, `controllers`, `models`, …). The DevTools extension
  uses the Tylix logo too.

- **Compiler diagnostics**: `diagnoseTyx(source, options)` returns every
  problem in a page, component or capability with its line and column in
  the file, plus an outline of its props, state, computed values and
  actions. Lexer, parser and template errors now carry a source offset.
  Errors inside `{{ }}`, attribute values and `{{#if}}` / `{{#each}}`
  headers point inside the expression. Unclosed tags and blocks point at
  where they were opened, and an unclosed bracket that hides the
  `template` section is reported where it opens.
- **Fixed**: typecheck errors in a page's template were reported on the
  wrong line (counted as if they were in the script).
- **Fixed**: the dev error page took the line from "at line N" in the
  message, which counts from the start of a section, so the code frame
  often showed the wrong line. Errors in a component or capability were
  framed against the page's source.
- **`tylix check`**: parses (and in TypeScript projects typechecks) every
  `.tyx` file under `app/` with `pretty`, `json` and `github` output.
- **`tylix build`** checks every `.tyx` file, not just pages, and now does
  it in JavaScript projects too: a syntax error used to pass the build and
  fail at runtime.
- **Faster typechecking**: TypeScript's lib files are parsed once per
  process. `tylix check` on the starter app went from 18.6s to 6.0s.
- **Dev error overlay**: the compile error page names the file that
  failed (component, layout or capability), underlines the line and
  column, lists every other problem in the file, links to the file in
  VS Code, and reloads by itself when the fix is saved. Uncaught errors
  and unhandled rejections in the browser show in an overlay.
- **`@tylix/language-server`** (new package) and a **VS Code extension**
  (`editors/vscode`): highlighting, snippets, live errors, type checking,
  completion, hover, go to definition and outline for `.tyx` files. Files
  that don't start with `page`, `component` or `capability` (generator
  templates) are left alone.
- **Tylix DevTools** (`devtools/extension`): a Chrome/Firefox panel to
  inspect and edit the live state of pages, components and capabilities.
  The native runtime reports instances to `window.__TYLIX_DEVTOOLS_HOOK__`
  when it exists. `tylix dev` installs the hook; production pages don't
  have it.

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
