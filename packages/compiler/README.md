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

## Usage

Used internally by `@tylix/core` (dev server) and `@tylix/cli`
(`build`, `dev`) to turn `.tyx` files into runnable pages/components.
Not typically imported directly in application code.

## License

MIT
