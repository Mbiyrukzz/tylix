# @tylix/compiler

Compiles `.tyx` page and component files into runnable JavaScript,
with full TypeScript support.

## What's included

- **Lexer/Parser** — `Lexer`, `tokenTypes`, `Parser`, `parseComponent`,
  `parseTemplate`, `parseExpressionString` turn `.tyx` source into an AST
  (`ast/nodes.js`)
- **Codegen** — `generateExpression`, `generateStatement`, `generateMethod`,
  `generatePage`, `generateTemplate` turn the AST into JS output
- **Typecheck** — `buildVirtualTs`, `typecheckVirtualFile`, `typecheckPage`,
  and `transpileHelperSource` run `.tyx` scripts through the TypeScript
  Compiler API for full type-annotation support
- **Imports** — `extractImports`, `resolvePackageComponents` resolve
  component imports from external packages (e.g. `import { IconPlus }
from "tylix-icons"`) by reading a `tylix-components.json` manifest
  from the package's `node_modules` folder — a plain JSON map of
  exported name → `.tyx` file path — then reading that `.tyx` file's
  source so it can be compiled inline alongside locally-defined
  components. No bundler or special `package.json` exports map
  required; any package that ships a manifest and some `.tyx` files
  works.
- **Runtime** — `reactive` primitives
- `compileComponent` and `renderPageDocument` as the main entry points
  tying parsing → typecheck → codegen together

- **Diagnostics** — `diagnoseTyx(source, { typecheck, language })` returns
  every problem with its line and column in the file, plus an outline of
  the file's props, state, computed values and actions (used by
  `tylix check`, the dev error page and the language server)

## Template syntax

```html
<p>{{ user.name }}</p>                              <!-- text -->
<a href="{{ `/posts/${post.id}` }}">…</a>            <!-- attributes -->
<button onclick="{{ save() }}">Save</button>        <!-- events -->

{{#if loading}}…{{#else if error}}…{{#else}}…{{/if}}
{{#each item, i in items}}…{{#else}}empty{{/each}}

<!-- two-way binding -->
<input bind:value="{{ query }}" />                  <!-- also type=number (stores numbers), textarea, select, select multiple -->
<input type="checkbox" bind:checked="{{ agree }}" />
<input type="radio" value="s" bind:group="{{ size }}" />
<input type="checkbox" value="a" bind:group="{{ tags }}" />   <!-- array of checked values -->

<!-- classes and styles -->
<li class="item" class:active="{{ id is selected }}" class:done />   <!-- class:done = class:done="{{ done }}" -->
<div style:color="{{ color }}" style:--gap="{{ gap }}" style:fontSize="{{ size }}"></div>

<!-- event modifiers -->
<form onsubmit.prevent="{{ save() }}">
<a onclick.prevent.stop="{{ open() }}">
<input onkeydown.enter="{{ add() }}" onkeydown.esc="{{ cancel() }}" />
<textarea onkeydown.ctrl.enter="{{ send() }}"></textarea>
<!-- prevent stop self once capture passive · ctrl shift alt meta ·
     enter esc space tab up down left right delete backspace -->

<!-- promises -->
{{#await loadPosts()}}
  <p>Loading…</p>
{{#then posts}}
  {{#each p in posts}}<h2>{{ p.title }}</h2>{{/each}}
{{#catch error}}
  <p>{{ error.message }}</p>
{{/await}}
{{#await stats then s}}{{ s.total }}{{/await}}      <!-- no pending branch -->

<!-- trusted HTML (scripts in it never run) -->
<article>{{@html post.bodyHtml}}</article>
```

Components take children. Inside the component, `<slot />` renders
them, `<slot name="x">` renders the children marked `slot="x"`, and
content inside `<slot>` is the fallback:

```html
<!-- Card.tyx -->
<article><h2>{{ title }}</h2><slot>No content</slot><footer><slot name="footer" /></footer></article>

<!-- a page -->
<Card title="Hello">
  <p>Body, with the page's own state: {{ count }}</p>
  <button slot="footer" onclick="{{ count = count + 1 }}">+1</button>
</Card>
```

## Usage

Used internally by `@tylix/core` (dev server) and `@tylix/cli`
(`build`, `dev`) to turn `.tyx` files into runnable pages/components.
Not typically imported directly in application code.

## License

MIT
