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

```sh
tylix make:feature Invoice title:string:required total:float:default=0 customer:belongsTo
tylix field:add Invoice status:string:index:default=draft
tylix make:migration add_paid_at_to_invoices_table paid_at:datetime:nullable
```

From code:

```js
import { Blueprint, FeatureGenerator } from '@tylix/generator'

const blueprint = new Blueprint('Invoice')
  .field('title', 'string', { nullable: false })
  .field('number', 'string', { unique: true })
  .field('status', 'string', { index: true, default: 'draft' })
  .belongsTo('Customer') // customer_id, indexed

await new FeatureGenerator().generate(blueprint.timestamps().api().crud(), process.cwd())
```

Field options become schema-builder modifiers in the migration: `unique`,
`index`, `nullable` (`false` for NOT NULL) and `default`.

## License

MIT
