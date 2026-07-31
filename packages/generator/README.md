# @tylix/generator

Code generators that scaffold models, migrations, controllers,
validators, and dashboards for Tylix apps.

## What's included

- `Blueprint` — the schema definition object generators build against
- `TemplateEngine` — renders `.tyx` / `-ts.tyx` template files
- `ModelGenerator`, `MigrationGenerator`, `AlterMigrationGenerator`,
  `ControllerGenerator`, `ValidatorGenerator`, `DashboardGenerator`
- `FeatureGenerator` — orchestrates model + migration + controller +
  validator generation together for `tylix make:feature`
- `PostBoilerplateGenerator` — runs after scaffolding to wire up
  language-specific (JS/TS) boilerplate

## Usage

Generators back the CLI's `make:*` commands rather than being called
directly:
