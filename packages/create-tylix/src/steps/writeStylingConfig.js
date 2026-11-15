import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

const templatePath = (name) =>
  path.join(PACKAGE_ROOT, 'src', 'templates', name)

// The Tylix UI tokens and components, placed between Tailwind's base and
// utilities so a utility class can still override a component.
const UI_MARKER = /\/\*!? tylix-ui \*\//

async function withUi(css) {
  const ui = await fs.readFile(templatePath('tylix-ui.css'), 'utf-8')
  if (!UI_MARKER.test(css)) throw new Error('styling template is missing the tylix-ui marker')
  return css.replace(UI_MARKER, () => ui.trim())
}

const USER_STYLES_HEADER = `/* Your own styles. This file is linked after the framework styles,
   so rules here can override them. */\n`

export async function writeStylingConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const stylesPath = path.join(targetDir, 'public', 'styles.css')

  if (config.styling === 'tailwind') {
    for (const [filename, templateName] of [
      ['tailwind.config.js', 'tailwind.config.js.template'],
      ['postcss.config.js', 'postcss.config.js.template'],
    ]) {
      let content = await fs.readFile(templatePath(templateName), 'utf-8')
      // A hosted frontend's source lives in app/views. Vite runs
      // Tailwind through postcss.config.js, so only the content globs change.
      const hosted = config.frontend && config.frontend !== 'tylix'
      if (filename === 'tailwind.config.js' && hosted) {
        content = content.replace(
          'content: ["./app/**/*.tyx"],',
          'content: ["./app/views/**/*.{html,js,jsx,ts,tsx,svelte,vue}"],',
        )
      }
      await fs.writeFile(path.join(targetDir, filename), content)
    }

    const inputCss = await withUi(
      await fs.readFile(templatePath('tailwind-input.css.template'), 'utf-8'),
    )
    await fs.writeFile(
      path.join(targetDir, 'app', 'tailwind-input.css'),
      inputCss,
    )

    // Plain CSS alongside Tailwind: an empty file the user owns.
    // renderPageDocument links /tailwind.css first, then /styles.css.
    await fs.writeFile(stylesPath, USER_STYLES_HEADER)
    return
  }

  // Plain CSS, Sass and CSS Modules: the starter templates use Tailwind
  // classes, so ship the precompiled stylesheet and let the user append
  // their own rules below it.
  const starterCss = await withUi(
    await fs.readFile(templatePath('starter.css'), 'utf-8'),
  )
  await fs.writeFile(
    stylesPath,
    `/* Precompiled styles for the starter templates. Add your own rules below. */\n${starterCss}\n`,
  )
}