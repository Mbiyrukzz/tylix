# @tylix/shared

Common utilities, config loading, and validation used across every
Tylix package.

## What's included

- **Strings** — `pascalCase`, `pluralize`
- **Filesystem** — `writeFile`
- **Schema** — `columnTypes`, used by the generator's model/migration templates
- **Config** — `loadConfig`, `loadEnv`, `detectLanguage` (JS vs TS detection for scaffolding)
- **Validation** — `rules`, `validate`, `resolveFieldRules`
- **Utils** — `banner` (CLI banner output)

No dependencies on other `@tylix` packages — this is the base layer
everything else builds on. Ships with a `d.ts` declaration file.

## Usage

```js
import { pascalCase, pluralize, loadConfig, validate } from '@tylix/shared'
```

## License

MIT
