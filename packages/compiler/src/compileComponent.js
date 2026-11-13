import { parseComponent } from './parser/parseComponent.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import { normalizeLanguageOptions } from './parser/languageOptions.js'
import { generatePage } from './codegen/generatePage.js'
import { generateTemplate } from './codegen/generateTemplate.js'
import {
  generateStatement,
  declaredNames,
} from './codegen/generateStatement.js'
import { reactive, effect, untracked } from './runtime/reactive.js'
import { useApi } from './runtime/useApi.js'

/**
 * Compiles raw .tyx source into a mountable component descriptor.
 *
 *   const Badge = compileComponent(badgeSource, "Badge");
 *   const Counter = compileComponent(counterSource, "Counter");
 *   const { node } = Counter.mount(document, { Badge });
 *
 * The `components` map passed to mount() lets a template reference
 * other compiled components by capitalized tag name (<Badge />);
 * omit it for components that don't nest anything.
 *
 * `languageOption` takes the same compiler switches as
 * renderPageDocument, e.g. { not: 'loose' }.
 *
 * Module-level declarations in the script (function, const, let,
 * class, enum) are scoped to this component and attached to each
 * instance so the template can call them.
 */
export function compileComponent(
  source,
  className = 'Component',
  languageOption = {},
) {
  const language = normalizeLanguageOptions(languageOption ?? {})
  const { script, template } = parseComponent(source)

  const pageNode =
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize(), language).parse()
      : { props: [], state: [], computed: [], actions: [], helpers: [] }

  const classSource = generatePage(pageNode, className)

  const helpers = pageNode.helpers ?? []
  const helperSource = helpers
    .map((h) => generateStatement(h, false))
    .filter((s) => s.trim().length > 0)
    .join('\n')
  const exposed = helpers
    .flatMap(declaredNames)
    .map((n) => `${JSON.stringify(n)}: ${n}`)
    .join(', ')

  const { Class: ComponentClass, helperValues } = new Function(
    'reactive',
    'useApi',
    `${helperSource}\nconst __Class = ${classSource};\nreturn { Class: __Class, helperValues: { ${exposed} } };`,
  )(reactive, useApi)

  const templateNodes = parseTemplate(template, language)
  const { code, rootVar } = generateTemplate(templateNodes)

  return {
    ComponentClass,
    mount(document, components = {}) {
      const instance = new ComponentClass()
      for (const key of Object.keys(helperValues)) {
        instance[key] = helperValues[key]
      }
      const renderFn = new Function(
        'document',
        'effect',
        'instance',
        'components',
        'reactive',
        'untracked',
        `${code}\nreturn ${rootVar};`,
      )
      const node = renderFn(document, effect, instance, components, reactive, untracked)
      return { node, instance }
    },
  }
}