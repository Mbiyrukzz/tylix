# Tylix for VS Code

Language support for Tylix `.tyx` pages, components and capabilities.

- **Syntax highlighting** for the script sections, the template (tags, `{{ }}`, `{{#if}}` / `{{#each}}`, components), `style`, and Tylix word operators (`is`, `has`, `exists`, `missing`, `and`, `or`, `not`).
- **Live errors** as you type, at the exact line and column, from the same compiler your app builds with.
- **Type checking** in TypeScript projects (a project with `tsconfig.json` or `tylix.config.ts`), the same check `tylix dev` and `tylix build` run.
- **Completion**: state, computed values, actions and props (in `{{ }}` and after `this.`), `{{#each}}` loop variables, capabilities and their members (`Auth.` → `user`, `logout`), imported components after `<`, and section keywords.
- **Hover** for members, capabilities and Tylix keywords.
- **Go to definition** for members, capability members, imports and component tags.
- **Outline** of each file's props, state, computed values and actions.
- **Snippets**: `page`, `component`, `capability`, `act`, `aact`, `comp`, `onMount`, `useApi`, `#if`, `#ife`, `#each`, `#eachi`, `imp`.

Only files that start with `page`, `component` or `capability` get Tylix features. Other `.tyx` files (such as code-generator templates) are highlighted as JavaScript and never get errors.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `tylix.typecheck` | `auto` | `auto`: typecheck in TypeScript projects. `always` or `never` to override. |
| `tylix.trace.server` | `off` | Log language server traffic in the **Tylix** output channel. |

Compiler switches such as `compiler: { not: 'loose' }` are read from your `tylix.config` file. The file is read as text and never executed.

## Workspace trust

In a trusted workspace, the server uses your project's own `@tylix/compiler` (when it is new enough), so the editor parses exactly like your build. In an untrusted workspace it uses the compiler bundled with the extension and never loads code from the project.

## Other editors

The language server is published separately as `@tylix/language-server`. Run `tylix-language-server --stdio` and associate it with `*.tyx`.
