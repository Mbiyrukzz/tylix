/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/templates/**/*',
    '!./src/templates/starter.css',
    '!./src/templates/starter-input.css',
    './src/steps/**/*.js',
  ],
  blocklist: ['[-:.TZ]'],
  theme: {
    extend: {
      colors: {
        tylix: { blue: '#8b5cf6', orange: '#e879f9' },
        emerald: {
          400: 'rgb(var(--brand-400, 52 211 153) / <alpha-value>)',
          500: 'rgb(var(--brand-500, 16 185 129) / <alpha-value>)',
          600: 'rgb(var(--brand-600, 5 150 105) / <alpha-value>)',
          700: 'rgb(var(--brand-700, 4 120 87) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}