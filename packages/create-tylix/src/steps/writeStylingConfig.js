import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

export async function writeStylingConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)

  if (config.styling === 'tailwind') {
    for (const [filename, templateName] of [
      ['tailwind.config.js', 'tailwind.config.js.template'],
      ['postcss.config.js', 'postcss.config.js.template'],
    ]) {
      const content = await fs.readFile(
        path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
        'utf-8',
      )
      await fs.writeFile(path.join(targetDir, filename), content)
    }
    const inputCss = await fs.readFile(
      path.join(
        PACKAGE_ROOT,
        'src',
        'templates',
        'tailwind-input.css.template',
      ),
      'utf-8',
    )
    await fs.writeFile(
      path.join(targetDir, 'app', 'tailwind-input.css'),
      inputCss,
    )
    return
  }

  if (config.styling === 'plain-css') {
    await fs.writeFile(
      path.join(targetDir, 'public', 'styles.css'),
      '/* your styles */\n',
    )
    return
  }

  // css-modules and sass: no scaffold-time config file needed yet —
  // Vite/webpack handle *.module.css and *.scss out of the box once
  // the build tooling exists. Nothing real to write here today.
}
