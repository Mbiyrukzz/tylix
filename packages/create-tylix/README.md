# create-tylix

Scaffolds a new Tylix application.

## What's included

- Interactive project scaffolder with JS/TS language detection
  (via `@tylix/shared`'s `detectLanguage`) threaded through
  `FeatureGenerator`, `PostBoilerplateGenerator`, and `AuthGenerator`
- Sets up `@tylix/core`, `@tylix/auth`, and `@tylix/generator` wiring
  in the new project
- Resolves `file:`-style local dependency references into real
  published versions for the scaffolded, standalone project

## Usage

`@latest` matters here since this is a scaffolder people run once —
pinning to a stale cached version would scaffold outdated templates.

## License

MIT
