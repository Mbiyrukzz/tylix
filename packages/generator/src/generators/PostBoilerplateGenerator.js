import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, detectLanguage } from '@tylix/shared'
import { Blueprint } from '../blueprint/Blueprint.js'
import { FeatureGenerator } from './FeatureGenerator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'templates', 'post')

// Writes the fixed "create a post / view it / delete it" boilerplate that
// ships with the starter template.
//
// Model, migration, and the feature.json manifest are produced by the
// same Blueprint -> FeatureGenerator pipeline that `tylix make:feature`
// uses, so discoverFeatures/registerFeatureRoutes pick "posts" up
// automatically at /api/posts, gated behind requireAuth via .auth().
//
// The generated controller/validator don't know about per-user
// ownership (index isn't scoped to req.user, show has no owner check),
// which this feature needs, so those two files get overwritten with
// hand-written versions right after generation. The overwrite templates
// mirror the language FeatureGenerator picked (via detectLanguage), so a
// TypeScript project doesn't end up with a stray .ts + .js pair.
export class PostBoilerplateGenerator {
  async generate(baseDir) {
    const blueprint = new Blueprint('Post')
      .field('title', 'string')
      .field('body', 'text')
      .belongsTo('User')
      .timestamps()
      .auth()
      .crud()

    const results = await new FeatureGenerator().generate(blueprint, baseDir)

    const language = await detectLanguage(baseDir)
    const ext = language === 'typescript' ? 'ts' : 'js'
    const suffix = language === 'typescript' ? '-ts' : ''

    // Controller/validator are real .ts/.js source — they get the
    // language-specific template variant.
    const readSource = (name) =>
      fs.readFile(path.join(TEMPLATES_DIR, `${name}${suffix}.tyx`), 'utf-8')

    // Pages are compiled by @tylix/compiler from the .tyx dialect
    // (state/action/template blocks) and never differ by backend
    // language, so this always reads the single, unsuffixed template.
    const readPage = (name) =>
      fs.readFile(path.join(TEMPLATES_DIR, `${name}.tyx`), 'utf-8')

    results.controller = await writeFile(
      path.join(baseDir, 'app', 'controllers', `PostController.${ext}`),
      await readSource('post-controller'),
      { overwrite: true },
    )

    results.validator = await writeFile(
      path.join(baseDir, 'app', 'validators', `PostValidator.${ext}`),
      await readSource('post-validator'),
      { overwrite: true },
    )

    results.postDetailPage = await writeFile(
      path.join(baseDir, 'app', 'pages', 'post', 'post-detail.tyx'),
      await readPage('post-detail-page'),
      { overwrite: true },
    )

    return results
  }
}
