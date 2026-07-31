# @tylix/cli

The `tylix` command-line tool for developing, scaffolding, and
running Tylix applications.

## Commands

**Dev/build**

- `tylix dev [--port=3000]` — start the dev server
- `tylix build` — build for production

**Scaffolding**

- `tylix make:model <Name>`
- `tylix make:migration <Name>`
- `tylix make:controller <Name>`
- `tylix make:validator <Name> [field:type ...]`
- `tylix make:feature <Name> [field:type ...] [--dashboard]`
- `tylix make:auth`
- `tylix make:page <Name>`
- `tylix make:component <Name>`
- `tylix make:channel <name>`
- `tylix make:icon <Name> "<svg path d attribute>"`

**Schema**

- `tylix field:add <feature> [field:type ...]`
- `tylix field:remove <feature> [fieldNames...]`
- `tylix migrate`

**Runtime workers**

- `tylix queue:work`
- `tylix schedule:work`
- `tylix channels:work`

**Misc**

- `tylix db:seed`
- `tylix tinker`
- `tylix doctor`

TypeScript projects (detected via `tsconfig.json` in the project root)
are automatically registered with `tsx/esm/api` before any command
runs, so `.ts` source resolves under Node 22's ESM loader.

## License

MIT
