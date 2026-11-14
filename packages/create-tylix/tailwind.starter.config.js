/** @type {import('tailwindcss').Config} */
// Builds src/templates/starter.css: the utilities the starter templates use,
// precompiled for projects that don't run Tailwind. Keep `colors` in step
// with src/templates/tailwind.config.js.template.
const token = (name) => `rgb(var(--tx-${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: [
    './src/templates/**/*',
    '!./src/templates/starter.css',
    '!./src/templates/starter-input.css',
    '!./src/templates/tylix-ui.css',
    './src/steps/**/*.js',
  ],
  blocklist: ['[-:.TZ]'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        panel: token('panel'),
        raised: token('raised'),
        well: token('well'),
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        ink: token('ink'),
        soft: token('soft'),
        muted: token('muted'),
        brand: { DEFAULT: token('brand'), hover: token('brand-hover'), deep: '#0034CA' },
        link: token('link'),
        mint: token('mint'),
        coral: token('coral'),
        peach: token('peach'),
        signal: token('signal'),
        aqua: token('aqua'),
      },
      fontFamily: {
        sans: 'var(--tx-font)',
        mono: 'var(--tx-mono)',
      },
    },
  },
  plugins: [],
}
