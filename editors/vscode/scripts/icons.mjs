// Generates every icon the extension ships from one vector of the Tylix
// mark (traced from packages/create-tylix/assets/logo-mark.png):
//
//   icons/tylix-mark.svg       the mark itself
//   icons/tyx.svg              .tyx file icon (also the language icon,
//                              shown by any icon theme without its own)
//   icons/theme/*.svg          the "Tylix Icons" file icon theme
//   icons/tylix-icon-theme.json
//
// The PNGs (extension icon, DevTools extension icons) are rendered from
// icons/tylix-mark.svg with ImageMagick: `node scripts/icons.mjs --png`.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICONS = path.join(EXT, 'icons')
const THEME = path.join(ICONS, 'theme')
fs.mkdirSync(THEME, { recursive: true })

const PURPLE = '#923FFF'

// The mark in a 122 x 102 box.
const MARK_PATHS = [
  'M0 0H122L104 20H18Z', // top bar
  'M40 20H49V84L77 52L80 50V72L54 102L40 88Z', // stem and point
  'M69 20H96L64 54H60V32Z', // upper stroke
]
const mark = (x, y, w, fill = PURPLE) => {
  const s = w / 122
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(4)})" fill="${fill}">${MARK_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`
}
const svg = (body, size = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>\n`

const write = (file, text) => fs.writeFileSync(file, text)

// ------------------------------------------------------------ the mark
write(path.join(ICONS, 'tylix-mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 122 102">${mark(0, 0, 122)}</svg>\n`)
write(path.join(ICONS, 'tyx.svg'), svg(mark(1, 2.6, 14)))

// ------------------------------------------------------- folder shapes
const folder = (color, open = false) =>
  open
    ? `<path d="M1.5 3.5A1 1 0 0 1 2.5 2.5H6l1.5 1.5h6a1 1 0 0 1 1 1V6H4.2a1 1 0 0 0-.95.68L1.5 12Z" fill="${color}" opacity=".75"/><path d="M3.3 6.7A1 1 0 0 1 4.25 6H15a.6.6 0 0 1 .57.8l-1.8 6a1 1 0 0 1-.96.7H2a.5.5 0 0 1-.48-.65Z" fill="${color}"/>`
    : `<path d="M1.5 3.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z" fill="${color}"/>`

// A Tylix folder: purple folder with a white mark.
const tylixFolder = (open) => svg(folder(PURPLE, open) + mark(open ? 6.2 : 5, open ? 8 : 6.6, 7, '#fff'))
write(path.join(THEME, 'folder-tylix.svg'), tylixFolder(false))
write(path.join(THEME, 'folder-tylix-open.svg'), tylixFolder(true))
write(path.join(THEME, 'folder.svg'), svg(folder('#8A94A6')))
// Well-known folders the earlier tylix.tyx-language icon theme covered.
const COLORED_FOLDERS = { node: '#689F63', git: '#E8673C', src: '#4C8DD8', tests: '#D9A93B', github: '#6E7681' }
for (const [name, color] of Object.entries(COLORED_FOLDERS)) {
  write(path.join(THEME, `folder-${name}.svg`), svg(folder(color)))
  write(path.join(THEME, `folder-${name}-open.svg`), svg(folder(color, true)))
}
write(path.join(THEME, 'folder-open.svg'), svg(folder('#8A94A6', true)))

// ---------------------------------------------------------- file icons
// A labelled badge: short text on a coloured rounded square.
const badge = (label, color, fg = '#fff') =>
  svg(
    `<rect x="1" y="2" width="14" height="12" rx="2" fill="${color}"/>` +
      `<text x="8" y="10.8" text-anchor="middle" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-weight="700" font-size="${label.length > 2 ? 5.2 : 6.6}" fill="${fg}">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`,
  )
const doc = (color) =>
  svg(`<path d="M3.5 1.5h6l3 3v10h-9Z" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 1.5v3h3" fill="none" stroke="${color}" stroke-width="1.2"/>`)

const FILES = {
  file: doc('#8A94A6'),
  'tylix-config': svg(`<circle cx="8" cy="8" r="7" fill="${PURPLE}"/>` + mark(4, 4.9, 8, '#fff')),
  js: badge('JS', '#F0DB4F', '#323330'),
  ts: badge('TS', '#3178C6'),
  json: badge('{ }', '#CBA200'),
  css: badge('#', '#2965F1'),
  html: badge('<>', '#E44D26'),
  md: badge('M↓', '#4C6EF5'),
  env: badge('ENV', '#5B8C3A'),
  image: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="#26A69A" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1.3" fill="#26A69A"/><path d="M2.5 12.5 6.5 8.5l2.5 2.5 2-2 3 3" fill="none" stroke="#26A69A" stroke-width="1.2" stroke-linejoin="round"/>'),
  db: svg('<ellipse cx="8" cy="4" rx="5.5" ry="2" fill="#9C6ADE"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4c0 1.1-2.5 2-5.5 2S2.5 5.1 2.5 4Z" fill="#7B4FC4"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="#8A94A6"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#8A94A6" stroke-width="1.4"/>'),
  git: svg('<path d="m8 1 7 7-7 7-7-7Z" fill="#F05033"/><circle cx="8" cy="8" r="1.6" fill="#fff"/>'),
}
for (const [name, text] of Object.entries(FILES)) write(path.join(THEME, `${name}.svg`), text)
fs.copyFileSync(path.join(ICONS, 'tyx.svg'), path.join(THEME, 'tyx.svg'))

// ---------------------------------------------------------- the theme
// Folders a Tylix app has (see create-tylix and the generators).
const TYLIX_FOLDERS = [
  'app', 'pages', 'components', 'capabilities', 'controllers', 'models',
  'migrations', 'validators', 'routes', 'jobs', 'observers', 'traits',
  'channels', 'mail', 'services', 'useApi', 'middleware', 'features',
  'frontend', 'database', 'resources', 'public', 'config', 'dashboard',
]

const defs = {}
const def = (id, file) => (defs[id] = { iconPath: `./theme/${file}.svg` })
for (const f of ['folder', 'folder-open', 'folder-tylix', 'folder-tylix-open', 'tyx', ...Object.keys(FILES)]) def(f, f)
for (const name of Object.keys(COLORED_FOLDERS)) {
  def(`folder-${name}`, `folder-${name}`)
  def(`folder-${name}-open`, `folder-${name}-open`)
}

const folderNames = {}
const folderNamesExpanded = {}
for (const f of TYLIX_FOLDERS) {
  folderNames[f] = 'folder-tylix'
  folderNamesExpanded[f] = 'folder-tylix-open'
}
const OTHER_FOLDERS = {
  node_modules: 'node', '.git': 'git', src: 'src', lib: 'src',
  test: 'tests', tests: 'tests', __tests__: 'tests', e2e: 'tests', '.github': 'github',
}
for (const [f, icon] of Object.entries(OTHER_FOLDERS)) {
  folderNames[f] = `folder-${icon}`
  folderNamesExpanded[f] = `folder-${icon}-open`
}

const theme = {
  hidesExplorerArrows: false,
  iconDefinitions: defs,
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  rootFolder: 'folder',
  rootFolderExpanded: 'folder-open',
  folderNames,
  folderNamesExpanded,
  fileExtensions: {
    tyx: 'tyx',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
    ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'ts',
    json: 'json', jsonc: 'json',
    css: 'css', scss: 'css',
    html: 'html', htm: 'html',
    md: 'md', markdown: 'md',
    env: 'env',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', ico: 'image',
    sqlite: 'db', db: 'db', sql: 'db',
  },
  fileNames: {
    'tylix.config.js': 'tylix-config',
    'tylix.config.ts': 'tylix-config',
    'tylix.config.mjs': 'tylix-config',
    '.env': 'env',
    '.env.example': 'env',
    '.env.local': 'env',
    'package-lock.json': 'lock',
    '.gitignore': 'git',
    '.gitattributes': 'git',
  },
  languageIds: { tyx: 'tyx' },
  light: undefined,
}
delete theme.light
write(path.join(ICONS, 'tylix-icon-theme.json'), `${JSON.stringify(theme, null, 2)}\n`)
console.log(`wrote ${Object.keys(defs).length} icons, ${TYLIX_FOLDERS.length} Tylix folders`)

// --------------------------------------------------------------- PNGs
if (process.argv.includes('--png')) {
  const tmp = path.join(ICONS, '.icon-src.svg')
  // Extension icon: the mark on a dark rounded tile, legible on both
  // the Marketplace's light and dark backgrounds.
  write(tmp, `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#17121F"/>${mark(50, 66, 156)}</svg>`)
  execFileSync('magick', ['-background', 'none', '-density', '300', tmp, '-resize', '256x256', path.join(EXT, 'icon.png')])
  const devtools = path.resolve(EXT, '..', '..', 'devtools', 'extension', 'icons')
  for (const size of [16, 32, 48, 128]) {
    execFileSync('magick', ['-background', 'none', '-density', '600', tmp, '-resize', `${size}x${size}`, path.join(devtools, `icon-${size}.png`)])
  }
  fs.rmSync(tmp)
  console.log('wrote icon.png and devtools/extension/icons/*.png')
}
