# Changelog

All Tylix packages share one version number and are released together.

## Unreleased

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
